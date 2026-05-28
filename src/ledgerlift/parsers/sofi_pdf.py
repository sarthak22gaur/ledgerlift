"""Parser for SoFi Bank monthly PDF statements.

SoFi statements contain both Checking and Savings account sections in a single
PDF. Each section has its own account number, balances, and transaction list.

Structure:
  - Statement period: "Aug 1, 2025 - Aug 31, 2025"
  - Account sections: "Checking Account - XXXX" / "Savings Account - XXXX"
  - Each section: DATE TYPE DESCRIPTION AMOUNT BALANCE
  - Transaction dates: "Mon DD, YYYY" (e.g., "Aug 31, 2025")
  - Amounts: $X.XX or -$X.XX (negative for debits/outflows)
  - Each transaction followed by "Transaction ID: XX-XXXXXXX"
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
from ledgerlift.utils.money import parse_amount
from ledgerlift.utils.pdf import extract_text_pages
from ledgerlift.utils.text import clean_raw_text, normalize_whitespace

logger = logging.getLogger(__name__)

PARSER_NAME = "sofi_pdf"
PARSER_VERSION = "0.1.0"

MONTH_ABBR = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

# Statement period: "Aug 1, 2025 - Aug 31, 2025"
PERIOD_RE = re.compile(
    r"Monthly Statement Period\s+"
    r"([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})\s*-\s*([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})",
)

# Account section headers: "Checking Account - XXXX" or "Savings Account - XXXX"
SECTION_RE = re.compile(r"(Checking|Savings)\s+Account\s*-\s*(\d{4})")

# Balance lines: "$300.35" on its own line (after "Current Balance" or "Beginning Balance" headers)
BALANCE_RE = re.compile(
    r"(Beginning|Current)\s+Balance.*?\n\$?([\d,]+\.\d{2})",
    re.MULTILINE,
)

# Transaction line: Mon DD, YYYY TYPE+DESC [-]$AMOUNT $BALANCE
TRANSACTION_RE = re.compile(
    r"^([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s+"  # date
    r"(.+?)\s+"                                    # type + description
    r"(-?\$[\d,]+\.\d{2})\s+"                     # amount
    r"\$[\d,]+\.\d{2}$"                           # balance (captured but ignored)
)

# Transaction ID line (used as reference number)
TXN_ID_RE = re.compile(r"Transaction ID:\s*(\S+)")

# Contact section marks end of transactions
CONTACT_RE = re.compile(r"Contact Information")


def _parse_mon_dd_yyyy(s: str) -> date | None:
    """Parse 'Mon DD, YYYY' like 'Aug 31, 2025'."""
    m = re.match(r"([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})", s.strip())
    if not m:
        return None
    month = MONTH_ABBR.get(m.group(1).lower())
    if month is None:
        return None
    try:
        return date(int(m.group(3)), month, int(m.group(2)))
    except ValueError:
        return None


class SoFiPDFParser(BaseParser):

    @property
    def name(self) -> str:
        return PARSER_NAME

    @property
    def version(self) -> str:
        return PARSER_VERSION

    def parse(self, pdf_path: Path, file_hash: str) -> ParsedStatement:
        logger.info("Parsing SoFi statement: %s", pdf_path.name)
        warnings: list[str] = []

        try:
            pages = extract_text_pages(pdf_path)
        except Exception as e:
            raise ParseError(f"Failed to extract text from {pdf_path}: {e}") from e

        if not pages or not any(p.strip() for p in pages):
            raise ParseError(f"No text extracted from {pdf_path}")

        full_text = "\n\n--- PAGE BREAK ---\n\n".join(pages)
        full_text = clean_raw_text(full_text)

        metadata = self._extract_metadata(full_text)
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

    def _extract_metadata(self, text: str) -> StatementMetadata:
        start_date = None
        end_date = None
        m = PERIOD_RE.search(text)
        if m:
            start_date = _parse_mon_dd_yyyy(f"{m.group(1)} {m.group(2)}, {m.group(3)}")
            end_date = _parse_mon_dd_yyyy(f"{m.group(4)} {m.group(5)}, {m.group(6)}")

        # Collect account last-4 digits from all sections
        account_numbers = set()
        for m in SECTION_RE.finditer(text):
            account_numbers.add(m.group(2))
        account_last4 = ",".join(sorted(account_numbers)) if account_numbers else None

        # Extract balances from the first account section (checking)
        beginning_balance = None
        ending_balance = None
        for m in BALANCE_RE.finditer(text):
            val = parse_amount(m.group(2))
            if val is not None:
                label = m.group(1).lower()
                if "beginning" in label and beginning_balance is None:
                    beginning_balance = val
                elif "current" in label and ending_balance is None:
                    ending_balance = val

        return StatementMetadata(
            institution="sofi",
            account_name="bank",
            account_type="bank",
            statement_start_date=start_date,
            statement_end_date=end_date,
            account_number_last4=account_last4,
            beginning_balance=beginning_balance,
            ending_balance=ending_balance,
        )

    def _parse_transactions(self, text: str, warnings: list[str]) -> list[RawTransaction]:
        lines = text.split("\n")
        transactions: list[RawTransaction] = []
        current_section: str | None = None

        i = 0
        while i < len(lines):
            line = lines[i].strip()
            i += 1

            if not line:
                continue

            # Track which account section we're in
            section_match = SECTION_RE.search(line)
            if section_match:
                current_section = section_match.group(1).lower()  # "checking" or "savings"
                continue

            # Skip boilerplate
            if "PAGE BREAK" in line:
                continue
            if line.startswith("DATE") and "TYPE" in line:
                continue
            if CONTACT_RE.search(line):
                # End of transaction section for current account
                continue
            if line.startswith("Balances below"):
                continue

            # Parse transaction line
            txn_match = TRANSACTION_RE.match(line)
            if txn_match:
                date_str = txn_match.group(1)
                desc_full = normalize_whitespace(txn_match.group(2))
                amount_raw = txn_match.group(3)

                # Parse amount: remove $ sign, handle negative
                amount_str = amount_raw.replace("$", "").replace(",", "")
                if amount_str.startswith("-"):
                    direction = Direction.DEBIT
                else:
                    direction = Direction.CREDIT

                # Peek at next line for Transaction ID
                reference = None
                if i < len(lines):
                    tid_match = TXN_ID_RE.match(lines[i].strip())
                    if tid_match:
                        reference = tid_match.group(1)
                        i += 1

                transactions.append(RawTransaction(
                    date_str=date_str,
                    description=desc_full,
                    amount_str=amount_str,
                    direction=direction,
                    reference_number=reference,
                    section=current_section,
                ))

        return transactions
