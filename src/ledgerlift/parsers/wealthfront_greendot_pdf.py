"""Parser for Wealthfront Cash Account Green Dot Bank monthly PDF statements.

Green Dot statements contain the actual transactions (bill payments, deposits,
ACH transfers) for the Wealthfront Cash Account.

Structure:
  - Statement period: "Sep. 06, 2025 to Oct. 05, 2025"
  - Account number: "XXXX-XXXX-XXXX-XX"
  - TRANSACTIONS section with: MM/DD/YYYY DESCRIPTION [+/-] $AMOUNT, followed by Debit/Deposit on next line
  - SWEEP TRANSACTIONS section (internal transfers — skipped)
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

PARSER_NAME = "wealthfront_greendot_pdf"
PARSER_VERSION = "0.1.0"

# Statement period: "Sep. 06, 2025 to Oct. 05, 2025"
MONTH_ABBR = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

PERIOD_RE = re.compile(
    r"(\w{3,4})\.?\s*(\d{1,2}),\s*(\d{4})\s+to\s+(\w{3,4})\.?\s*(\d{1,2}),\s*(\d{4})",
    re.IGNORECASE,
)

ACCOUNT_RE = re.compile(r"(\d{4}-\d{4}-\d{4}-\d{2})")

BALANCE_RE = re.compile(
    r"(Beginning|Ending)\s+Balance\s+(?:on\s+\S+\s+\d+,\s+\d+\s+)?\$?([\d,]+\.\d{2})",
    re.IGNORECASE,
)

# Transaction line: MM/DD/YYYY DESCRIPTION [+-] $AMOUNT
TRANSACTION_RE = re.compile(
    r"^(\d{2}/\d{2}/\d{4})\s+"  # date
    r"(.+?)\s+"                  # description
    r"([+-])\s*\$\s*([\d,]+\.\d{2})$"  # sign + amount
)

# Sweep section header
SWEEP_RE = re.compile(r"SWEEP TRANSACTIONS", re.IGNORECASE)


def _parse_period_date(month_str: str, day: int, year: int) -> date | None:
    m = MONTH_ABBR.get(month_str.lower().rstrip("."))
    if m is None:
        return None
    try:
        return date(year, m, day)
    except ValueError:
        return None


class WealthfrontGreenDotPDFParser(BaseParser):

    @property
    def name(self) -> str:
        return PARSER_NAME

    @property
    def version(self) -> str:
        return PARSER_VERSION

    def parse(self, pdf_path: Path, file_hash: str) -> ParsedStatement:
        logger.info("Parsing Wealthfront Green Dot statement: %s", pdf_path.name)
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
        start_date = None
        end_date = None
        m = PERIOD_RE.search(text)
        if m:
            start_date = _parse_period_date(m.group(1), int(m.group(2)), int(m.group(3)))
            end_date = _parse_period_date(m.group(4), int(m.group(5)), int(m.group(6)))

        account_last4 = None
        m = ACCOUNT_RE.search(text)
        if m:
            account_last4 = m.group(1)[-4:]  # last 2 digits + dash formatting

        beginning_balance = None
        ending_balance = None
        for m in BALANCE_RE.finditer(text):
            val = parse_amount(m.group(2))
            if val is not None:
                if "beginning" in m.group(1).lower() and beginning_balance is None:
                    beginning_balance = val
                elif "ending" in m.group(1).lower() and ending_balance is None:
                    ending_balance = val

        return StatementMetadata(
            institution="wealthfront",
            account_name="cash_greendot",
            account_type="cash",
            statement_start_date=start_date,
            statement_end_date=end_date,
            account_number_last4=account_last4,
            beginning_balance=beginning_balance,
            ending_balance=ending_balance,
        )

    def _parse_transactions(self, text: str, warnings: list[str]) -> list[RawTransaction]:
        lines = text.split("\n")
        transactions: list[RawTransaction] = []
        in_sweep = False

        i = 0
        while i < len(lines):
            line = lines[i].strip()
            i += 1

            if not line:
                continue

            # Stop at sweep section
            if SWEEP_RE.search(line):
                in_sweep = True
                continue

            # Resume only if we hit a plain "TRANSACTIONS" header (multi-page)
            # Do NOT resume on "DATE DESCRIPTION AMOUNT" column headers — those
            # appear inside the sweep section too.
            if line == "TRANSACTIONS":
                in_sweep = False
                continue

            if in_sweep:
                continue

            # Skip column headers
            if line.startswith("DATE") and "DESCRIPTION" in line:
                continue

            # Skip page headers and boilerplate
            if line.startswith("Page") or "PAGE BREAK" in line:
                continue
            if "STATEMENT PERIOD" in line:
                continue
            if line.startswith("ACCOUNT SUMMARY") or line.startswith("CONTACT"):
                continue

            txn_match = TRANSACTION_RE.match(line)
            if txn_match:
                date_str = txn_match.group(1)
                description = normalize_whitespace(txn_match.group(2))
                sign = txn_match.group(3)
                amount_str = txn_match.group(4)

                if sign == "-":
                    direction = Direction.DEBIT
                    amount_str = f"-{amount_str}"
                else:
                    direction = Direction.CREDIT

                # Skip the "Debit" / "Deposit" label on the next line
                if i < len(lines) and lines[i].strip() in ("Debit", "Deposit", "Credit"):
                    i += 1

                transactions.append(RawTransaction(
                    date_str=date_str,
                    description=description,
                    amount_str=amount_str,
                    direction=direction,
                ))

        return transactions
