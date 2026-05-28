"""Parser for Capital One credit card monthly PDF statements.

Capital One Venture X credit card statements have this structure:

Page 1: Summary page with account info, period, balances.
  - "Venture X Card | Visa Infinite ending in XXXX"
  - Period: "Mon DD, YYYY - Mon DD, YYYY | NN days in Billing Cycle"
  - Account Summary: Previous Balance, Payments, Other Credits, Transactions,
    Fees, Interest, New Balance

Transaction pages (page 2+):
  - Section: "CARDHOLDER #LAST4: Payments, Credits and Adjustments"
    These are CREDITS (payments, refunds). Amounts prefixed with "- $".
    Line format: Mon DD Mon DD DESCRIPTION - $AMOUNT

  - Section: "CARDHOLDER #LAST4: Transactions"
    These are DEBITS (purchases). Amounts shown as "$AMOUNT".
    Line format: Mon DD Mon DD DESCRIPTION $AMOUNT

  - "Transactions (Continued)" header on subsequent pages continues the
    previous section without repeating the sub-header.

  - Foreign currency transactions have extra lines after the USD amount:
      $59.00
      GBP
      0.728305148 Exchange Rate

  - Summary/total lines like "CARDHOLDER #LAST4: Total Transactions $X,XXX.XX"
    and "Total Transactions for This Period $X,XXX.XX" should be skipped.

Date format: "Mon DD" (e.g., "Feb 24", "Mar 7") — month abbreviation + day.
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
from ledgerlift.utils.dates import infer_year_from_path
from ledgerlift.utils.money import parse_amount
from ledgerlift.utils.pdf import extract_text_pages
from ledgerlift.utils.text import clean_raw_text, normalize_whitespace

logger = logging.getLogger(__name__)

PARSER_NAME = "capital_one_credit_pdf"
PARSER_VERSION = "0.1.0"

# --- Month abbreviation mapping ---
MONTH_ABBR = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4,
    "may": 5, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

# --- Statement period pattern ---
# "Feb 14, 2025 - Mar 16, 2025 | 31 days in Billing Cycle"
PERIOD_RE = re.compile(
    r"([A-Z][a-z]{2}\s+\d{1,2},?\s*\d{4})\s*-\s*([A-Z][a-z]{2}\s+\d{1,2},?\s*\d{4})",
)

# --- Account number / card ending ---
# "ending in XXXX"
ENDING_IN_RE = re.compile(r"ending in\s+(\d{4})", re.IGNORECASE)

# --- Balance extraction ---
PREVIOUS_BALANCE_RE = re.compile(
    r"Previous\s+Balance\s+[-]?\$?([\d,]+\.\d{2})", re.IGNORECASE
)
NEW_BALANCE_RE = re.compile(
    r"New\s+Balance\s*=?\s*[-]?\$?([\d,]+\.\d{2})", re.IGNORECASE
)

# --- Section headers ---
# "CARDHOLDER #LAST4: Payments, Credits and Adjustments"
CREDIT_SECTION_RE = re.compile(
    r"#\d{4}:\s*Payments,?\s*Credits?\s*and\s*Adjustments?", re.IGNORECASE
)
# "CARDHOLDER #LAST4: Transactions"
DEBIT_SECTION_RE = re.compile(
    r"#\d{4}:\s*Transactions\s*$", re.IGNORECASE
)
# "Transactions (Continued)"
CONTINUED_RE = re.compile(r"Transactions\s*\(Continued\)", re.IGNORECASE)

# --- Summary / total lines to skip ---
SKIP_RE = re.compile(
    r"(?:"
    r"Total\s+(?:Transactions|Fees|Interest|Payments|Credits)"
    r"|#\d{4}:\s*Total\s+"
    r"|Total\s+.*for\s+This\s+Period"
    r"|Totals\s+Year-to-Date"
    r"|Interest\s+Charged?\s*$"
    r"|Interest\s+Charge\s+on"
    r")",
    re.IGNORECASE,
)

# --- Transaction line pattern ---
# Capital One format: "Mon DD Mon DD DESCRIPTION [-] $AMOUNT"
# Trans date and post date are both "Mon DD".
# Credit amounts: "- $280.00"
# Debit amounts: "$81.01"
#
# Month abbreviation: 3 letters, first uppercase.
_MON = r"[A-Z][a-z]{2}"
_DAY = r"\d{1,2}"

TRANSACTION_RE = re.compile(
    rf"^({_MON}\s+{_DAY})\s+"       # trans date
    rf"({_MON}\s+{_DAY})\s+"        # post date
    r"(.+?)\s+"                      # description (non-greedy)
    r"(-\s*)?\$([\d,]+\.\d{2})$"     # optional "- " prefix, then $AMOUNT
)

# --- Foreign currency extra lines ---
# After a transaction, these lines may appear:
#   $59.00
#   GBP
#   0.728305148 Exchange Rate
CURRENCY_CODE_RE = re.compile(r"^[A-Z]{3}$")
EXCHANGE_RATE_RE = re.compile(r"^\d+\.\d+\s+Exchange\s+Rate", re.IGNORECASE)
FOREIGN_AMOUNT_RE = re.compile(r"^\$?[\d,]+\.\d{2}$")

# --- Fees / Interest section headers ---
FEES_SECTION_RE = re.compile(r"^Fees\s*$", re.IGNORECASE)
INTEREST_SECTION_RE = re.compile(
    r"^Interest\s+Charge[ds]?\s*$", re.IGNORECASE
)


def _parse_mon_dd(text: str, year: int) -> date | None:
    """Parse a 'Mon DD' date string with an assumed year.

    E.g., 'Feb 24' -> date(year, 2, 24).
    """
    text = text.strip()
    m = re.match(rf"({_MON})\s+(\d{{1,2}})", text)
    if not m:
        return None
    month_str = m.group(1).lower()
    month = MONTH_ABBR.get(month_str)
    if month is None:
        return None
    day = int(m.group(2))
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _parse_full_date(text: str) -> date | None:
    """Parse 'Mon DD, YYYY' (e.g. 'Feb 14, 2025') into a date."""
    text = text.strip()
    m = re.match(r"([A-Za-z]{3})\s+(\d{1,2}),?\s*(\d{4})", text)
    if not m:
        return None
    month_str = m.group(1).lower()
    month = MONTH_ABBR.get(month_str)
    if month is None:
        return None
    day = int(m.group(2))
    year = int(m.group(3))
    try:
        return date(year, month, day)
    except ValueError:
        return None


class CapitalOneCreditPDFParser(BaseParser):
    """Parser for Capital One credit card PDF statements."""

    @property
    def name(self) -> str:
        return PARSER_NAME

    @property
    def version(self) -> str:
        return PARSER_VERSION

    def parse(self, pdf_path: Path, file_hash: str) -> ParsedStatement:
        """Parse a Capital One credit card PDF statement."""
        logger.info("Parsing Capital One credit statement: %s", pdf_path.name)
        warnings: list[str] = []

        try:
            pages = extract_text_pages(pdf_path)
        except Exception as e:
            raise ParseError(
                f"Failed to extract text from {pdf_path}: {e}"
            ) from e

        if not pages or not any(p.strip() for p in pages):
            raise ParseError(f"No text extracted from {pdf_path}")

        full_text = "\n\n--- PAGE BREAK ---\n\n".join(pages)
        full_text = clean_raw_text(full_text)

        # Extract metadata
        metadata = self._extract_metadata(full_text, pdf_path)
        if metadata.statement_start_date is None:
            warnings.append("Could not detect statement period")

        year = self._determine_year(metadata, pdf_path)

        # Parse transactions
        raw_transactions = self._parse_transactions(full_text, year, warnings)

        if not raw_transactions:
            warnings.append("No transactions extracted from statement")

        logger.info(
            "Extracted %d transactions from %s",
            len(raw_transactions),
            pdf_path.name,
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

    def _extract_metadata(
        self, text: str, pdf_path: Path
    ) -> StatementMetadata:
        """Extract statement metadata from the full text."""
        start_date = None
        end_date = None
        m = PERIOD_RE.search(text)
        if m:
            start_date = _parse_full_date(m.group(1))
            end_date = _parse_full_date(m.group(2))

        # Account last 4
        account_last4 = None
        m = ENDING_IN_RE.search(text)
        if m:
            account_last4 = m.group(1)

        # Previous Balance (beginning balance for credit cards)
        beginning_balance = None
        m = PREVIOUS_BALANCE_RE.search(text)
        if m:
            beginning_balance = parse_amount(m.group(1))

        # New Balance (ending balance)
        ending_balance = None
        m = NEW_BALANCE_RE.search(text)
        if m:
            ending_balance = parse_amount(m.group(1))

        return StatementMetadata(
            institution="capitalone",
            account_name="credit",
            account_type="credit",
            statement_start_date=start_date,
            statement_end_date=end_date,
            account_number_last4=account_last4,
            beginning_balance=beginning_balance,
            ending_balance=ending_balance,
        )

    def _determine_year(
        self, metadata: StatementMetadata, pdf_path: Path
    ) -> int:
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

    def _parse_transactions(
        self, full_text: str, year: int, warnings: list[str]
    ) -> list[RawTransaction]:
        """Parse all transaction lines from the full text."""
        lines = full_text.split("\n")
        transactions: list[RawTransaction] = []
        current_direction: Direction | None = None
        in_fees_or_interest = False

        i = 0
        while i < len(lines):
            line = lines[i].strip()
            i += 1

            if not line:
                continue

            # Check for credit section header (Payments, Credits and Adjustments)
            if CREDIT_SECTION_RE.search(line):
                current_direction = Direction.CREDIT
                in_fees_or_interest = False
                continue

            # Check for debit section header (Transactions)
            if DEBIT_SECTION_RE.search(line):
                current_direction = Direction.DEBIT
                in_fees_or_interest = False
                continue

            # "Transactions (Continued)" keeps the previous direction
            if CONTINUED_RE.search(line):
                # If we haven't seen a section yet, default to debit
                # (continued usually follows the Transactions section)
                if current_direction is None:
                    current_direction = Direction.DEBIT
                in_fees_or_interest = False
                continue

            # Fees section contains real fee transactions (e.g., annual fee)
            if FEES_SECTION_RE.match(line):
                current_direction = Direction.DEBIT
                in_fees_or_interest = False
                continue

            # Interest section only has summary lines, skip it
            if INTEREST_SECTION_RE.match(line):
                in_fees_or_interest = True
                continue

            if in_fees_or_interest:
                continue

            # Skip summary / total lines
            if SKIP_RE.search(line):
                continue

            # Skip page break markers
            if "--- PAGE BREAK ---" in line:
                continue

            # Try to match a transaction line
            txn_match = TRANSACTION_RE.match(line)
            if txn_match:
                trans_date_str = txn_match.group(1)
                post_date_str = txn_match.group(2)
                description = normalize_whitespace(txn_match.group(3))
                neg_prefix = txn_match.group(4)  # "- " or None
                amount_raw = txn_match.group(5)   # digits like "280.00"

                # Build the amount string
                if neg_prefix:
                    # Credit: "- $280.00" -> payment/refund
                    direction = Direction.CREDIT
                    amount_str = amount_raw
                else:
                    # Debit: "$81.01" -> purchase
                    direction = Direction.DEBIT
                    amount_str = amount_raw

                # Use section-based direction if available, otherwise use
                # the sign-based direction from the line itself
                effective_direction = current_direction or direction

                # Combine trans date + post date in date_str
                date_str = f"{trans_date_str} | {post_date_str}"

                section_name = (
                    "payments_credits_adjustments"
                    if effective_direction == Direction.CREDIT
                    else "transactions"
                )

                transactions.append(
                    RawTransaction(
                        date_str=date_str,
                        description=description,
                        amount_str=amount_str,
                        direction=effective_direction,
                        section=section_name,
                    )
                )

                # Skip any foreign currency extra lines that follow
                i = self._skip_foreign_currency_lines(lines, i)
                continue

        return transactions

    def _skip_foreign_currency_lines(
        self, lines: list[str], i: int
    ) -> int:
        """Skip foreign currency detail lines after a transaction.

        These look like:
            $59.00
            GBP
            0.728305148 Exchange Rate

        Returns the new index position.
        """
        while i < len(lines):
            peek = lines[i].strip()
            if not peek:
                i += 1
                continue
            if FOREIGN_AMOUNT_RE.match(peek):
                i += 1
                continue
            if CURRENCY_CODE_RE.match(peek):
                i += 1
                continue
            if EXCHANGE_RATE_RE.match(peek):
                i += 1
                continue
            # Not a foreign currency line, stop
            break
        return i
