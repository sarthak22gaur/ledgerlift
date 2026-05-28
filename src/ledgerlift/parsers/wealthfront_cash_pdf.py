"""Parser for Wealthfront Cash Account (brokerage-side) monthly PDF statements.

These statements show:
  - Deposits/Credits to Wealthfront Brokerage (RTP/FedNow transfers in, sweep from Green Dot)
  - Withdrawals/Debits from Wealthfront Brokerage (RTP/FedNow transfers out, sweep to Green Dot)
  - Interest payments
  - Program Bank transfers (internal — skipped)

Most transactions here are internal sweep movements between Green Dot and
Wealthfront. The interesting ones are RTP/FedNow transfers and interest.

Structure:
  - Period: "October 1 - 31, 2025"
  - Account: "8W162S8T"
  - Deposits/Credits section: Date Method Status Amount
  - Withdrawals/Debits section: Date Method Status Amount
  - Interest section: Date Interest Period Amount
  - Transfer between Wealthfront and Program Banks (skip)
"""

from __future__ import annotations

import logging
import re
from datetime import date
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

PARSER_NAME = "wealthfront_cash_pdf"
PARSER_VERSION = "0.1.0"

MONTH_NAMES = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}

# "October 1 - 31, 2025" or "February 1 - 28, 2025"
PERIOD_RE = re.compile(
    r"(\w+)\s+(\d{1,2})\s*-\s*(\d{1,2}),\s*(\d{4})",
)

ACCOUNT_RE = re.compile(r"Wealthfront:\s*(\w+)")

BALANCE_RE = re.compile(
    r"(Starting|Ending)\s+Balance\s+\$?([\d,]+\.\d{2})", re.IGNORECASE
)

# Transaction line: MM/DD/YYYY Method Status [-]$Amount
TRANSACTION_RE = re.compile(
    r"^(\d{1,2}/\d{1,2}/\d{4})\s+"  # date
    r"(.+?)\s+"                       # description/method
    r"(?:Received|Disbursed)\s+"      # status
    r"(-?\$[\d,]+\.\d{2})$"          # amount
)

# Interest line: MM/DD/YYYY Month YYYY $Amount
INTEREST_RE = re.compile(
    r"^(\d{1,2}/\d{1,2}/\d{4})\s+"
    r"(\w+\s+\d{4})\s+"
    r"\$([\d,]+\.\d{2})$"
)

# Sections to detect
DEPOSITS_RE = re.compile(r"Deposits/Credits", re.IGNORECASE)
WITHDRAWALS_RE = re.compile(r"Withdrawals/Debits", re.IGNORECASE)
INTEREST_SECTION_RE = re.compile(r"^INTEREST", re.IGNORECASE)
PROGRAM_BANK_RE = re.compile(r"Transfer between Wealthfront and Program", re.IGNORECASE)


def _parse_period(text: str) -> tuple[date | None, date | None]:
    m = PERIOD_RE.search(text)
    if not m:
        return None, None
    month_name = m.group(1).lower()
    month = MONTH_NAMES.get(month_name)
    if month is None:
        return None, None
    day_start = int(m.group(2))
    day_end = int(m.group(3))
    year = int(m.group(4))
    try:
        return date(year, month, day_start), date(year, month, day_end)
    except ValueError:
        return None, None


class WealthfrontCashPDFParser(BaseParser):

    @property
    def name(self) -> str:
        return PARSER_NAME

    @property
    def version(self) -> str:
        return PARSER_VERSION

    def parse(self, pdf_path: Path, file_hash: str) -> ParsedStatement:
        logger.info("Parsing Wealthfront Cash statement: %s", pdf_path.name)
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

        raw_transactions = self._parse_transactions(full_text, warnings)

        if not raw_transactions:
            warnings.append("No transactions extracted from statement")

        logger.info("Extracted %d transactions from %s", len(raw_transactions), pdf_path.name)

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
        start_date, end_date = _parse_period(text)

        account_id = None
        m = ACCOUNT_RE.search(text)
        if m:
            account_id = m.group(1)

        beginning_balance = None
        ending_balance = None
        for m in BALANCE_RE.finditer(text):
            val = parse_amount(m.group(2))
            if val is not None:
                if "starting" in m.group(1).lower() and beginning_balance is None:
                    beginning_balance = val
                elif "ending" in m.group(1).lower() and ending_balance is None:
                    ending_balance = val

        return StatementMetadata(
            institution="wealthfront",
            account_name="cash",
            account_type="cash",
            statement_start_date=start_date,
            statement_end_date=end_date,
            account_number_last4=account_id[-4:] if account_id else None,
            beginning_balance=beginning_balance,
            ending_balance=ending_balance,
        )

    def _parse_transactions(self, text: str, warnings: list[str]) -> list[RawTransaction]:
        lines = text.split("\n")
        transactions: list[RawTransaction] = []
        current_direction: Direction | None = None
        in_program_bank = False

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # Detect sections
            if DEPOSITS_RE.search(line):
                current_direction = Direction.CREDIT
                in_program_bank = False
                continue
            if WITHDRAWALS_RE.search(line):
                current_direction = Direction.DEBIT
                in_program_bank = False
                continue
            if INTEREST_SECTION_RE.match(line):
                current_direction = Direction.CREDIT
                in_program_bank = False
                continue
            if PROGRAM_BANK_RE.search(line):
                in_program_bank = True
                continue

            if in_program_bank:
                continue

            # Try transaction match
            txn_match = TRANSACTION_RE.match(line)
            if txn_match:
                date_str = txn_match.group(1)
                description = normalize_whitespace(txn_match.group(2))
                amount_raw = txn_match.group(3).replace("$", "").replace(",", "")

                parsed_amt = parse_amount(amount_raw)
                if parsed_amt is not None:
                    if parsed_amt < 0:
                        direction = Direction.DEBIT
                    else:
                        direction = current_direction or Direction.CREDIT

                    transactions.append(RawTransaction(
                        date_str=date_str,
                        description=description,
                        amount_str=str(abs(parsed_amt)) if direction == Direction.CREDIT else str(parsed_amt),
                        direction=direction,
                    ))
                continue

            # Try interest match
            int_match = INTEREST_RE.match(line)
            if int_match:
                date_str = int_match.group(1)
                period = int_match.group(2)
                amount_str = int_match.group(3)

                transactions.append(RawTransaction(
                    date_str=date_str,
                    description=f"Interest - {period}",
                    amount_str=amount_str,
                    direction=Direction.CREDIT,
                    section="interest",
                ))

        return transactions
