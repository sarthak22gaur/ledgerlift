"""Parser for Deserve EDU credit card monthly PDF statements.

Deserve statements have a fixed structure across pages:
  - Page 1: Account summary, balances, statement period
  - Page 2: Disclosures (skipped)
  - Page 3+: Transactions in sections:
    - "Payments and Credits": Transaction ID, Txn Date, Post Date, Description, Amount
    - "New Charges": Card#, Transaction ID, Txn Date, Post Date, Merchant/Location, Amount
      (merchant entries span multiple lines with address info)
    - "Fees" / "Interest Charged" sections (usually empty)
  - Last page: Plan Summary with beginning/ending balances

Amounts:
  - Payments/credits: negative in parens, e.g., ($58.76)
  - Charges: positive, e.g., $58.76
  - Dates: MM/DD/YY
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

PARSER_NAME = "deserve_credit_pdf"
PARSER_VERSION = "0.1.0"

# Statement period: "Statement Period: MM/DD/YY to MM/DD/YY"
PERIOD_RE = re.compile(
    r"Statement Period:\s*(\d{2}/\d{2}/\d{2})\s+to\s+(\d{2}/\d{2}/\d{2})"
)

# Account number: "Account Number: 9000000500803961"
ACCOUNT_RE = re.compile(r"Account Number:\s*(\d{10,})")

# Balance from Plan Summary: "Deserve EDU Revolving 22.99% (V) $0.00 $58.76 ..."
# Beginning Balance and Ending Balance are in the Plan Summary table.
# We extract them from the "Previous Balance" and "New Balance" on page 1 instead.
PREV_BALANCE_RE = re.compile(r"Previous Balance\s+\$?([\d,]+\.\d{2})")
NEW_BALANCE_RE = re.compile(r"New Balance\s+\$?([\d,]+\.\d{2})")

# Payment/credit line: "TXNID MM/DD/YY MM/DD/YY DESCRIPTION ($AMOUNT)" or "$AMOUNT"
PAYMENT_RE = re.compile(
    r"^(\d{10})\s+(\d{2}/\d{2}/\d{2})\s+(\d{2}/\d{2}/\d{2})\s+(.+?)\s+"
    r"\(?\$?([\d,]+\.\d{2})\)?$"
)

# Charge line (first line): "CARD4 TXNID MM/DD/YY MM/DD/YY MERCHANT... $AMOUNT"
# The amount is always at the end, merchant name + address may follow on next lines.
CHARGE_FIRST_RE = re.compile(
    r"^(\d{4})\s+(\d{10})\s+(\d{2}/\d{2}/\d{2})\s+(\d{2}/\d{2}/\d{2})\s+(.+?)\s+\$?([\d,]+\.\d{2})$"
)

# Total lines marking end of sections
TOTAL_PAYMENTS_RE = re.compile(r"Total Payments and Credits for this Period")
TOTAL_CHARGES_RE = re.compile(r"Total New Charges for this Period")
TOTAL_FEES_RE = re.compile(r"Total Fees for this Period")
TOTAL_INTEREST_RE = re.compile(r"Total Interest for this Period")

# Section headers
SECTION_PAYMENTS = "Payments and Credits"
SECTION_CHARGES = "New Charges"
SECTION_FEES = "Fees"
SECTION_INTEREST = "Interest Charged"


def _parse_date_mmddyy(s: str) -> date | None:
    """Parse MM/DD/YY date string."""
    try:
        parts = s.split("/")
        if len(parts) != 3:
            return None
        month, day, year = int(parts[0]), int(parts[1]), int(parts[2])
        # 2-digit year: 00-99 -> 2000-2099
        if year < 100:
            year += 2000
        return date(year, month, day)
    except (ValueError, IndexError):
        return None


class DeserveCreditPDFParser(BaseParser):

    @property
    def name(self) -> str:
        return PARSER_NAME

    @property
    def version(self) -> str:
        return PARSER_VERSION

    def parse(self, pdf_path: Path, file_hash: str) -> ParsedStatement:
        logger.info("Parsing Deserve statement: %s", pdf_path.name)
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

    def _extract_metadata(self, text: str) -> StatementMetadata:
        start_date = None
        end_date = None
        m = PERIOD_RE.search(text)
        if m:
            start_date = _parse_date_mmddyy(m.group(1))
            end_date = _parse_date_mmddyy(m.group(2))

        account_last4 = None
        m = ACCOUNT_RE.search(text)
        if m:
            account_last4 = m.group(1)[-4:]

        beginning_balance = None
        m = PREV_BALANCE_RE.search(text)
        if m:
            beginning_balance = parse_amount(m.group(1))

        ending_balance = None
        m = NEW_BALANCE_RE.search(text)
        if m:
            ending_balance = parse_amount(m.group(1))

        return StatementMetadata(
            institution="deserve",
            account_name="credit",
            account_type="credit",
            statement_start_date=start_date,
            statement_end_date=end_date,
            account_number_last4=account_last4,
            beginning_balance=beginning_balance,
            ending_balance=ending_balance,
        )

    def _parse_transactions(
        self, text: str, warnings: list[str]
    ) -> list[RawTransaction]:
        lines = text.split("\n")
        transactions: list[RawTransaction] = []
        current_section: str | None = None

        i = 0
        while i < len(lines):
            line = lines[i].strip()
            i += 1

            if not line or "PAGE BREAK" in line:
                continue

            # Track section transitions
            if line == SECTION_PAYMENTS or line.startswith("Payments and Credits"):
                current_section = "payments"
                continue
            if line == SECTION_CHARGES or line.startswith("New Charges"):
                current_section = "charges"
                continue
            if line == SECTION_FEES or line.startswith("Fees"):
                current_section = "fees"
                continue
            if line == SECTION_INTEREST or line.startswith("Interest Charged"):
                current_section = "interest"
                continue

            # Skip header lines
            if line.startswith("Transaction ID") and "Transaction Date" in line:
                continue
            if line.startswith("Card Number") and "Transaction ID" in line:
                continue
            if line.startswith("* Last four"):
                continue
            if line.startswith("Continued on next page"):
                continue
            if line.startswith("Page ") and "/" in line:
                continue

            # End of section
            if (
                TOTAL_PAYMENTS_RE.search(line)
                or TOTAL_CHARGES_RE.search(line)
                or TOTAL_FEES_RE.search(line)
                or TOTAL_INTEREST_RE.search(line)
            ):
                current_section = None
                continue

            # Skip non-transaction sections
            if current_section is None:
                continue

            # Parse payment/credit lines
            if current_section == "payments":
                pm = PAYMENT_RE.match(line)
                if pm:
                    txn_id = pm.group(1)
                    date_str = pm.group(2)
                    description = normalize_whitespace(pm.group(4))
                    amount_str = pm.group(5).replace(",", "")

                    transactions.append(
                        RawTransaction(
                            date_str=date_str,
                            description=description,
                            amount_str=amount_str,
                            direction=Direction.CREDIT,
                            reference_number=txn_id,
                            section="payments",
                        )
                    )
                continue

            # Parse charge lines (multi-line: first line has amount, rest is address)
            if current_section == "charges":
                cm = CHARGE_FIRST_RE.match(line)
                if cm:
                    txn_id = cm.group(2)
                    date_str = cm.group(3)
                    merchant_raw = cm.group(5)
                    amount_str = cm.group(6).replace(",", "")

                    # Consume address continuation lines (until next charge, total, or section)
                    while i < len(lines):
                        next_line = lines[i].strip()
                        if not next_line:
                            i += 1
                            continue
                        # Stop if it's the next charge, a total, or a section header
                        if CHARGE_FIRST_RE.match(next_line):
                            break
                        if TOTAL_CHARGES_RE.search(next_line):
                            break
                        if next_line.startswith("* Last four"):
                            break
                        if next_line.startswith("Continued on next page"):
                            break
                        if next_line in (SECTION_FEES, SECTION_INTEREST):
                            break
                        if next_line.startswith("Page ") and "/" in next_line:
                            break
                        if "PAGE BREAK" in next_line:
                            break
                        # It's an address continuation line — skip it
                        i += 1

                    description = normalize_whitespace(merchant_raw)
                    transactions.append(
                        RawTransaction(
                            date_str=date_str,
                            description=description,
                            amount_str=amount_str,
                            direction=Direction.DEBIT,
                            reference_number=txn_id,
                            section="charges",
                        )
                    )
                continue

            # Fees and interest: same format as payments
            if current_section in ("fees", "interest"):
                pm = PAYMENT_RE.match(line)
                if pm:
                    txn_id = pm.group(1)
                    date_str = pm.group(2)
                    description = normalize_whitespace(pm.group(4))
                    amount_str = pm.group(5).replace(",", "")

                    transactions.append(
                        RawTransaction(
                            date_str=date_str,
                            description=description,
                            amount_str=amount_str,
                            direction=Direction.DEBIT,
                            reference_number=txn_id,
                            section=current_section,
                        )
                    )

        return transactions
