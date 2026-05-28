"""Parser for Chase checking account monthly PDF statements.

Chase checking statements use structured markers in the extracted text:
  *start*summary / *end*summary          — checking summary with balances
  *start*transaction detail / *end*transaction detail — transaction rows

Within the transaction detail section, sub-headers indicate direction:
  "Deposits and Additions"               — credits (positive)
  "ATM & Debit Card Withdrawals"         — debits (negative)
  "Electronic Withdrawals"               — debits (negative)
  etc.

Transaction lines have the format:
  MM/DD DESCRIPTION  AMOUNT  BALANCE

where AMOUNT is the transaction amount and BALANCE is the running balance.
Multi-line descriptions wrap to the next line(s) without a leading date.
"""

from __future__ import annotations

import logging
import re
from datetime import date
from decimal import Decimal
from pathlib import Path

from ledgerlift.models import (
    Direction,
    ParsedStatement,
    RawTransaction,
    StatementMetadata,
)
from ledgerlift.parsers.base import BaseParser, ParseError
from ledgerlift.utils.dates import (
    extract_statement_period,
    infer_year_from_path,
)
from ledgerlift.utils.money import parse_amount
from ledgerlift.utils.pdf import extract_text_pages
from ledgerlift.utils.text import clean_raw_text, normalize_whitespace

logger = logging.getLogger(__name__)

PARSER_NAME = "chase_checking_pdf"
PARSER_VERSION = "0.3.0"

# --- Section boundary markers ---
# Chase PDFs embed these markers in the extracted text.
# The end marker sometimes has a digit replacing the "t" in "transaction":
#   *end*transac1tion detail   (digit 1)
#   *end*transac0tion detail   (digit 0)
TXN_START_RE = re.compile(r"\*start\*transaction detail")
TXN_END_RE = re.compile(r"\*end\*transac\d?tion detail")

# --- Sub-section headers inside transaction detail ---
CREDIT_SECTIONS = {
    "deposits and additions",
    "deposits and other credits",
    "deposits",
}

DEBIT_SECTIONS = {
    "electronic withdrawals",
    "checks paid",
    "atm & debit card withdrawals",
    "atm and debit card withdrawals",
    "fees & other withdrawals",
    "fees and other withdrawals",
    "other withdrawals",
    "withdrawals and other debits",
    "withdrawals",
}

ALL_SECTIONS = CREDIT_SECTIONS | DEBIT_SECTIONS

# Build a regex to detect sub-section headers
_section_alts = "|".join(re.escape(s) for s in sorted(ALL_SECTIONS, key=len, reverse=True))
SECTION_HEADER_RE = re.compile(rf"^({_section_alts})\s*$", re.IGNORECASE)

# --- Transaction line pattern ---
# DATE  DESCRIPTION  AMOUNT  BALANCE
# The line ends with two dollar amounts; AMOUNT then BALANCE.
# AMOUNT may be negative (prefixed with -). BALANCE is always positive.
TRANSACTION_RE = re.compile(
    r"^(\d{2}/\d{2})\s+"                         # date MM/DD
    r"(.+?)\s+"                                   # description (non-greedy)
    r"(-?[\d,]+\.\d{2})\s+"                       # amount
    r"(-?[\d,]+\.\d{2})$"                         # balance (captured but not used)
)

# Some lines only have AMOUNT with no BALANCE (seen at end of sections or single-column layout)
TRANSACTION_NO_BALANCE_RE = re.compile(
    r"^(\d{2}/\d{2})\s+"
    r"(.+?)\s+"
    r"(-?[\d,]+\.\d{2})$"
)

# --- Metadata patterns ---
BALANCE_RE = re.compile(
    r"(?:Beginning|Ending)\s+Balance\s+\$?([\d,]+\.\d{2})",
    re.IGNORECASE,
)

SUMMARY_LINE_RE = re.compile(
    r"^(Deposits and Additions|"
    r"ATM & Debit Card (?:Withdrawals|Transactions)|"
    r"Electronic Withdrawals|"
    r"Checks Paid|"
    r"Fees & Other Withdrawals|"
    r"Other Withdrawals)\s+"
    r"(-?[\d,]+\.\d{2})",
    re.IGNORECASE,
)

ACCOUNT_NUMBER_RE = re.compile(r"(?:^|\s)(\d{9,16})(?:\s|$)")

# Lines to always skip
SKIP_RE = re.compile(
    r"^(?:"
    r"CHECKING SUMMARY|"
    r"TRANSACTION DETAIL|"
    r"DAILY ENDING BALANCE|"
    r"SERVICE CHARGE SUMMARY|"
    r"JPMorgan Chase|"
    r"DATE\s+DESCRIPTION\s+AMOUNT|"
    r"Beginning Balance|"
    r"Ending Balance|"
    r"Total |"
    r"Page of|"
    r"\d+ of \d+$|"
    r"This (?:page|statement)|"
    r"\(continued\)"
    r")",
    re.IGNORECASE,
)


class ChaseCheckingPDFParser(BaseParser):
    """Parser for Chase checking account PDF statements."""

    @property
    def name(self) -> str:
        return PARSER_NAME

    @property
    def version(self) -> str:
        return PARSER_VERSION

    def parse(self, pdf_path: Path, file_hash: str) -> ParsedStatement:
        """Parse a Chase checking PDF statement."""
        logger.info("Parsing Chase checking statement: %s", pdf_path.name)
        warnings: list[str] = []

        try:
            pages = extract_text_pages(pdf_path)
        except Exception as e:
            raise ParseError(f"Failed to extract text from {pdf_path}: {e}") from e

        if not pages or not any(p.strip() for p in pages):
            raise ParseError(f"No text extracted from {pdf_path}")

        full_text = "\n\n--- PAGE BREAK ---\n\n".join(pages)
        full_text = clean_raw_text(full_text)

        # Extract metadata from full text (including summary section)
        metadata = self._extract_metadata(full_text, pdf_path)
        if metadata.statement_start_date is None:
            warnings.append("Could not detect statement period")

        year = self._determine_year(metadata, pdf_path)

        # Extract only the transaction detail sections
        txn_lines = self._extract_transaction_lines(full_text)
        if not txn_lines:
            warnings.append("No transaction detail section found")

        # Parse transaction lines
        raw_transactions = self._parse_transaction_lines(txn_lines, warnings)

        if not raw_transactions:
            warnings.append("No transactions extracted from statement")

        # Infer direction from summary if sub-headers weren't found
        self._infer_directions_from_summary(raw_transactions, metadata, warnings)

        logger.info(
            "Extracted %d transactions from %s", len(raw_transactions), pdf_path.name
        )

        return ParsedStatement(
            source_file_hash=file_hash,
            source_file_path=str(pdf_path),
            metadata=metadata,
            raw_transactions=raw_transactions,
            extracted_text=full_text,
            warnings=warnings,
            parser_name=self.name,
            parser_version=self.version,
        )

    def _extract_metadata(self, text: str, pdf_path: Path) -> StatementMetadata:
        """Extract statement metadata from the full text."""
        start_date, end_date = extract_statement_period(text)

        # Find account number (long digit sequence, typically 9-16 digits)
        account_last4 = None
        for m in ACCOUNT_NUMBER_RE.finditer(text):
            digits = m.group(1)
            if len(digits) >= 9:
                account_last4 = digits[-4:]
                break

        # Find beginning/ending balance
        beginning_balance = None
        ending_balance = None
        for m in BALANCE_RE.finditer(text):
            amount = parse_amount(m.group(1))
            if amount is not None:
                line = m.group(0).lower()
                if "beginning" in line and beginning_balance is None:
                    beginning_balance = amount
                elif "ending" in line and ending_balance is None:
                    ending_balance = amount

        # Parse summary line totals
        total_deposits = None
        total_withdrawals = Decimal("0")
        for m in SUMMARY_LINE_RE.finditer(text):
            label = m.group(1).lower()
            amount = parse_amount(m.group(2))
            if amount is None:
                continue
            if "deposit" in label:
                total_deposits = abs(amount)
            else:
                total_withdrawals += abs(amount)

        return StatementMetadata(
            institution="chase",
            account_name="checking",
            account_type="checking",
            statement_start_date=start_date,
            statement_end_date=end_date,
            account_number_last4=account_last4,
            beginning_balance=beginning_balance,
            ending_balance=ending_balance,
            total_credits=total_deposits,
            total_debits=total_withdrawals if total_withdrawals else None,
        )

    def _determine_year(self, metadata: StatementMetadata, pdf_path: Path) -> int:
        """Determine the statement year from metadata or path."""
        if metadata.statement_end_date:
            return metadata.statement_end_date.year
        if metadata.statement_start_date:
            return metadata.statement_start_date.year
        year = infer_year_from_path(str(pdf_path))
        if year:
            return year
        logger.warning("Could not determine year, defaulting to current year")
        return date.today().year

    def _extract_transaction_lines(self, full_text: str) -> list[str]:
        """Extract only lines within *start*transaction detail / *end*transaction detail blocks.

        Handles multiple blocks (continued sections across pages) and the
        occasional malformed marker like *end*transac1tion detail.
        """
        lines = full_text.split("\n")
        txn_lines: list[str] = []
        inside = False

        for line in lines:
            stripped = line.strip()

            # Check for start marker
            if TXN_START_RE.search(stripped):
                inside = True
                # There might be text after the marker on the same line — skip it
                # (it's usually just the marker itself or "(continued)")
                continue

            # Check for end marker
            end_match = re.search(r"\*end\*transac(\d)?tion detail", stripped)
            if end_match:
                # The end marker can be glued to transaction text, e.g.:
                # "*end*transac1tion detail1/17 Card Purchase Return..."
                # "*end*transac0tion detail9/30 Hmf Hmfusa.Com..."
                # The digit in "transacXtion" is the FIRST digit of the month.
                # The text after "detail" starts with the SECOND digit of the month.
                stolen_digit = end_match.group(1)  # "1", "0", or None
                after_marker = stripped[end_match.end():].strip()

                if after_marker:
                    recovered = self._recover_transaction_after_marker(
                        after_marker, stolen_digit
                    )
                    if recovered:
                        txn_lines.append(recovered)

                inside = False
                continue

            if inside:
                txn_lines.append(stripped)

        return txn_lines

    def _parse_transaction_lines(
        self, lines: list[str], warnings: list[str]
    ) -> list[RawTransaction]:
        """Parse extracted transaction lines into RawTransaction objects."""
        transactions: list[RawTransaction] = []
        current_section: str | None = None
        pending: RawTransaction | None = None

        for line in lines:
            if not line:
                continue

            # Skip boilerplate
            if SKIP_RE.match(line):
                continue

            # Check for sub-section header
            section_match = SECTION_HEADER_RE.match(line)
            if section_match:
                if pending:
                    transactions.append(pending)
                    pending = None
                current_section = section_match.group(1).strip().lower()
                continue

            # Try to match transaction with balance (most common format)
            txn_match = TRANSACTION_RE.match(line)
            if txn_match:
                if pending:
                    transactions.append(pending)

                date_str = txn_match.group(1)
                description = normalize_whitespace(txn_match.group(2))
                amount_str = txn_match.group(3)

                direction = self._section_to_direction(current_section)

                pending = RawTransaction(
                    date_str=date_str,
                    description=description,
                    amount_str=amount_str,
                    direction=direction,
                    section=current_section,
                )
                continue

            # Try without balance column
            txn_match = TRANSACTION_NO_BALANCE_RE.match(line)
            if txn_match:
                if pending:
                    transactions.append(pending)

                date_str = txn_match.group(1)
                description = normalize_whitespace(txn_match.group(2))
                amount_str = txn_match.group(3)

                direction = self._section_to_direction(current_section)

                pending = RawTransaction(
                    date_str=date_str,
                    description=description,
                    amount_str=amount_str,
                    direction=direction,
                    section=current_section,
                )
                continue

            # Continuation line — append to pending transaction description
            if pending and self._is_continuation_line(line):
                pending.description = (
                    pending.description + " " + normalize_whitespace(line)
                )
                continue

            # Unrecognized line inside transaction section — log for debugging
            logger.debug("Unrecognized transaction line: %s", line[:100])

        # Flush last pending
        if pending:
            transactions.append(pending)

        return transactions

    def _section_to_direction(self, section: str | None) -> Direction | None:
        """Map a section name to a transaction direction. Returns None if unknown."""
        if section is None:
            return None
        if section in CREDIT_SECTIONS:
            return Direction.CREDIT
        if section in DEBIT_SECTIONS:
            return Direction.DEBIT
        return None

    def _infer_directions_from_summary(
        self,
        transactions: list[RawTransaction],
        metadata: StatementMetadata,
        warnings: list[str],
    ) -> None:
        """For transactions without a section-based direction, infer from the amount sign.

        In Chase statements without sub-headers, positive amounts in the
        AMOUNT column are credits (deposits) and negative amounts are debits.
        """
        for txn in transactions:
            if txn.direction is not None:
                continue

            # Parse the amount to check its sign
            amount = parse_amount(txn.amount_str)
            if amount is None:
                txn.direction = Direction.DEBIT  # default
                continue

            if amount < 0:
                txn.direction = Direction.DEBIT
            else:
                txn.direction = Direction.CREDIT

    @staticmethod
    def _recover_transaction_after_marker(
        text: str, stolen_digit: str | None = None
    ) -> str | None:
        """Try to recover a transaction line from text glued after an *end* marker.

        The PDF extraction sometimes merges the end marker with the next
        transaction. The digit in "transacXtion" is the first digit of the
        month, and the text after "detail" starts with the second month digit.

        Examples:
            *end*transac1tion detail1/17 ... → stolen_digit="1", text="1/17 ..." → "11/17 ..."
            *end*transac0tion detail9/30 ... → stolen_digit="0", text="9/30 ..." → "09/30 ..."

        Returns a cleaned transaction line or None.
        """
        if not text:
            return None

        # Case 1: already starts with a proper MM/DD date
        if re.match(r"\d{2}/\d{2}\s", text):
            return text

        # Case 2: starts with D/DD — reconstruct the two-digit month
        m = re.match(r"(\d)/(\d{2})\s+(.*)", text)
        if m:
            second_digit, day, rest = m.group(1), m.group(2), m.group(3)
            if stolen_digit is not None:
                # The stolen digit is the first digit of the month
                candidate = f"{stolen_digit}{second_digit}/{day} {rest}"
                month = int(f"{stolen_digit}{second_digit}")
                if 1 <= month <= 12:
                    return candidate

            # Fallback: try common prefixes
            for prefix in ("0", "1"):
                candidate = f"{prefix}{second_digit}/{day} {rest}"
                month = int(f"{prefix}{second_digit}")
                if 1 <= month <= 12:
                    return candidate

        # Case 3: just trailing text like "Card 1207" — not a transaction
        return None

    def _is_continuation_line(self, line: str) -> bool:
        """Check if a line is a continuation of a previous transaction description."""
        if not line or len(line) < 2:
            return False
        # Starts with a date — it's a new transaction
        if re.match(r"^\d{2}/\d{2}\s", line):
            return False
        # Is just a number — probably a balance line
        if re.match(r"^-?[\d,]+\.\d{2}$", line):
            return False
        # Contains section markers — not a continuation
        if "*start*" in line or "*end*" in line:
            return False
        return True
