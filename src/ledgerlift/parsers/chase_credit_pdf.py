"""Parser for Chase credit card monthly PDF statements.

Chase credit card statements have this structure:

Page 1: Summary with account info, balances, rewards.
  - "Account Number: XXXX XXXX XXXX 1234"
  - "Opening/Closing Date MM/DD/YY - MM/DD/YY"
  - Previous Balance, New Balance, Payment/Credits, Purchases

Transaction page(s):
  - Header: "ACCOUNT ACTIVITY" (often with doubled chars in PDF extraction)
  - Sub-sections:
    - "PAYMENTS AND OTHER CREDITS" — credits (negative amounts)
    - "PURCHASE" — debits (positive amounts)
    - "CASH ADVANCES", "BALANCE TRANSFERS" — debits
    - "FEES CHARGED" — debits
  - Transaction lines: MM/DD DESCRIPTION AMOUNT
  - "Year-to-Date" totals section should be skipped
  - "INTEREST CHARGES" section should be skipped

Amounts: positive in PURCHASE section (debits), negative in PAYMENTS section (credits).
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
from ledgerlift.utils.dates import infer_year_from_path, parse_date_mmdd
from ledgerlift.utils.money import parse_amount
from ledgerlift.utils.pdf import extract_text_pages
from ledgerlift.utils.text import clean_raw_text, normalize_whitespace

logger = logging.getLogger(__name__)

PARSER_NAME = "chase_credit_pdf"
PARSER_VERSION = "0.1.0"

# --- Metadata patterns ---
ACCOUNT_RE = re.compile(r"Account\s*(?:Number|number)\s*:\s*.*?(\d{4})\s*$", re.MULTILINE)

OPENING_CLOSING_RE = re.compile(
    r"Opening/Closing\s+Date\s+(\d{2}/\d{2}/\d{2})\s*-\s*(\d{2}/\d{2}/\d{2})",
    re.IGNORECASE,
)

PREV_BALANCE_RE = re.compile(
    r"Previous\s+Balance\s+(-?)\$?([\d,]+\.\d{2})", re.IGNORECASE
)
NEW_BALANCE_RE = re.compile(
    r"New\s+Balance\s+(-?)\$?([\d,]+\.\d{2})", re.IGNORECASE
)

# --- Section detection ---
CREDIT_SECTION_RE = re.compile(
    r"^PAYMENTS?\s+AND\s+OTHER\s+CREDITS?", re.IGNORECASE
)
PURCHASE_SECTION_RE = re.compile(r"^PURCHASE\s*$", re.IGNORECASE)
CASH_ADV_SECTION_RE = re.compile(r"^CASH\s+ADVANCE", re.IGNORECASE)
BAL_XFER_SECTION_RE = re.compile(r"^BALANCE\s+TRANSFER", re.IGNORECASE)
FEES_SECTION_RE = re.compile(r"^FEES\s+CHARGED", re.IGNORECASE)

# Sections where we stop parsing transactions
STOP_SECTIONS_RE = re.compile(
    r"(?:^\d{4}\s+Totals\s+Year|^INTEREST\s+CHARGE|^Year-to-date|^Annual\s+Percentage)",
    re.IGNORECASE,
)

# --- Transaction line ---
# MM/DD DESCRIPTION AMOUNT (positive or negative with optional -)
TRANSACTION_RE = re.compile(
    r"^(\d{2}/\d{2})\s+"  # date
    r"(.+?)\s+"            # description
    r"(-?\$?[\d,]+\.\d{2})$"  # amount (may have - prefix and/or $)
)

# Lines to skip
SKIP_RE = re.compile(
    r"(?:"
    r"^Date of$|"
    r"^Transaction\s+Merchant|"
    r"^\$\s*Amount$|"
    r"^Manage your|"
    r"^MMaannaaggee|"
    r"^www\.chase|"
    r"^Customer Service|"
    r"^Total\s+|"
    r"^Page\s*\d|"
    r"^\d+ of \d+|"
    r"^[A-Z]{2,}(?:\s+[A-Z]{2,})+\s+Page\d|"
    r"^Statement Date|"
    r"^\d{7}\s+FIS"
    r")",
    re.IGNORECASE,
)


def _is_account_activity_header(line: str) -> bool:
    """Detect 'ACCOUNT ACTIVITY' header, including doubled-char PDF artifacts
    and '(CONTINUED)' variants."""
    clean = re.sub(r"(.)\1", r"\1", line.upper().replace(" ", ""))
    return "ACCOUNTACTIVITY" in clean


def _parse_mmddyy(s: str) -> date | None:
    """Parse MM/DD/YY into a date."""
    m = re.match(r"(\d{2})/(\d{2})/(\d{2})", s.strip())
    if not m:
        return None
    month, day, yr = int(m.group(1)), int(m.group(2)), int(m.group(3))
    year = 2000 + yr if yr < 100 else yr
    try:
        return date(year, month, day)
    except ValueError:
        return None


class ChaseCreditPDFParser(BaseParser):
    """Parser for Chase credit card PDF statements."""

    @property
    def name(self) -> str:
        return PARSER_NAME

    @property
    def version(self) -> str:
        return PARSER_VERSION

    def parse(self, pdf_path: Path, file_hash: str) -> ParsedStatement:
        logger.info("Parsing Chase credit statement: %s", pdf_path.name)
        warnings: list[str] = []

        try:
            pages = extract_text_pages(pdf_path)
        except Exception as e:
            raise ParseError(f"Failed to extract text from {pdf_path}: {e}") from e

        if not pages or not any(p.strip() for p in pages):
            raise ParseError(f"No text extracted from {pdf_path}")

        full_text = "\n\n--- PAGE BREAK ---\n\n".join(pages)
        full_text = clean_raw_text(full_text)

        metadata = self._extract_metadata(full_text, pdf_path)
        if metadata.statement_start_date is None:
            warnings.append("Could not detect statement period")

        year = self._determine_year(metadata, pdf_path)

        raw_transactions = self._parse_transactions(full_text, year, warnings)

        if not raw_transactions:
            warnings.append("No transactions extracted from statement")

        logger.info(
            "Extracted %d transactions from %s",
            len(raw_transactions), pdf_path.name,
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
        start_date = None
        end_date = None
        m = OPENING_CLOSING_RE.search(text)
        if m:
            start_date = _parse_mmddyy(m.group(1))
            end_date = _parse_mmddyy(m.group(2))

        account_last4 = None
        m = ACCOUNT_RE.search(text)
        if m:
            account_last4 = m.group(1)

        beginning_balance = None
        m = PREV_BALANCE_RE.search(text)
        if m:
            sign = m.group(1)
            beginning_balance = parse_amount(m.group(2))
            if beginning_balance is not None and sign == "-":
                beginning_balance = -beginning_balance

        ending_balance = None
        # Find "New Balance" that has a dollar amount (skip headers)
        for m in NEW_BALANCE_RE.finditer(text):
            val = parse_amount(m.group(2))
            if val is not None:
                sign = m.group(1)
                ending_balance = -val if sign == "-" else val
                break

        return StatementMetadata(
            institution="chase",
            account_name="credit",
            account_type="credit",
            statement_start_date=start_date,
            statement_end_date=end_date,
            account_number_last4=account_last4,
            beginning_balance=beginning_balance,
            ending_balance=ending_balance,
        )

    def _determine_year(self, metadata: StatementMetadata, pdf_path: Path) -> int:
        if metadata.statement_end_date:
            return metadata.statement_end_date.year
        if metadata.statement_start_date:
            return metadata.statement_start_date.year
        year = infer_year_from_path(str(pdf_path))
        if year:
            return year
        return date.today().year

    def _parse_transactions(
        self, full_text: str, year: int, warnings: list[str]
    ) -> list[RawTransaction]:
        lines = full_text.split("\n")
        transactions: list[RawTransaction] = []
        current_direction: Direction | None = None
        in_activity = False
        stopped = False

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # Detect start of activity section
            # PDF extraction doubles chars: "AACCCCOOUUNNTT AACCTTIIVVIITTYY"
            if _is_account_activity_header(line):
                in_activity = True
                stopped = False
                continue

            if not in_activity:
                continue

            # Stop at year-to-date / interest charges
            if STOP_SECTIONS_RE.match(line):
                stopped = True
                continue

            if stopped:
                if _is_account_activity_header(line):
                    stopped = False
                    in_activity = True
                continue

            # Section headers
            if CREDIT_SECTION_RE.match(line):
                current_direction = Direction.CREDIT
                continue
            if PURCHASE_SECTION_RE.match(line):
                current_direction = Direction.DEBIT
                continue
            if CASH_ADV_SECTION_RE.match(line):
                current_direction = Direction.DEBIT
                continue
            if BAL_XFER_SECTION_RE.match(line):
                current_direction = Direction.DEBIT
                continue
            if FEES_SECTION_RE.match(line):
                current_direction = Direction.DEBIT
                continue

            # Skip boilerplate
            if SKIP_RE.match(line):
                continue

            # Page break
            if "--- PAGE BREAK ---" in line:
                continue

            # Try transaction match
            txn_match = TRANSACTION_RE.match(line)
            if txn_match:
                date_str = txn_match.group(1)
                description = normalize_whitespace(txn_match.group(2))
                amount_raw = txn_match.group(3)

                # Clean amount: remove $ sign
                amount_clean = amount_raw.replace("$", "").strip()
                parsed_amount = parse_amount(amount_clean)

                if parsed_amount is not None:
                    # Determine direction from amount sign or section
                    if parsed_amount < 0:
                        direction = Direction.CREDIT
                        amount_str = str(abs(parsed_amount))
                    else:
                        direction = current_direction or Direction.DEBIT
                        amount_str = str(parsed_amount)

                    section = None
                    if current_direction == Direction.CREDIT:
                        section = "payments_and_other_credits"
                    elif current_direction == Direction.DEBIT:
                        section = "purchase"

                    transactions.append(
                        RawTransaction(
                            date_str=date_str,
                            description=description,
                            amount_str=amount_str,
                            direction=direction,
                            section=section,
                        )
                    )

        return transactions
