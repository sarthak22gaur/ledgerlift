"""Parser for American Express credit card CSV activity exports.

Amex activity CSVs have these columns:
  Date, Description, Amount, Extended Details, Appears On Your Statement As,
  Address, City/State, Zip Code, Country, Reference, Category

Key behaviors:
- Dates are MM/DD/YYYY
- Positive amounts are purchases (debits)
- Negative amounts are payments/credits
- Category field provides merchant categorization
- Extended Details and Address fields have multi-line values
- No card number in the CSV — identified by column structure
"""

from __future__ import annotations

import csv
import logging
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from ledgerlift.models import (
    Direction,
    ParsedStatement,
    RawTransaction,
    StatementMetadata,
)
from ledgerlift.parsers.base import BaseParser, ParseError
from ledgerlift.utils.text import clean_raw_text, normalize_whitespace

logger = logging.getLogger(__name__)

PARSER_NAME = "amex_credit_csv"
PARSER_VERSION = "0.1.0"

EXPECTED_COLUMNS = {
    "Date", "Description", "Amount", "Extended Details",
    "Appears On Your Statement As", "Address", "City/State",
    "Zip Code", "Country", "Reference", "Category",
}


def is_amex_csv(path: Path) -> bool:
    """Check if a CSV file looks like an Amex activity export by inspecting its header."""
    try:
        with open(path, newline="") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            if header is None:
                return False
            return EXPECTED_COLUMNS.issubset(set(h.strip() for h in header))
    except Exception:
        return False


class AmexCreditCSVParser(BaseParser):
    """Parser for American Express credit card CSV activity exports."""

    @property
    def name(self) -> str:
        return PARSER_NAME

    @property
    def version(self) -> str:
        return PARSER_VERSION

    def parse(self, csv_path: Path, file_hash: str) -> ParsedStatement:
        """Parse an Amex activity CSV export."""
        logger.info("Parsing Amex credit CSV: %s", csv_path.name)
        warnings: list[str] = []

        try:
            with open(csv_path, newline="") as f:
                full_text = f.read()
        except Exception as e:
            raise ParseError(f"Failed to read {csv_path}: {e}") from e

        full_text = clean_raw_text(full_text)

        try:
            rows = list(csv.DictReader(full_text.splitlines()))
        except Exception as e:
            raise ParseError(f"Failed to parse CSV {csv_path}: {e}") from e

        if not rows:
            raise ParseError(f"No data rows in {csv_path}")

        # Verify columns
        actual_cols = set(rows[0].keys())
        if not EXPECTED_COLUMNS.issubset(actual_cols):
            missing = EXPECTED_COLUMNS - actual_cols
            raise ParseError(
                f"Missing expected columns in {csv_path}: {missing}"
            )

        # Extract metadata from date range
        metadata = self._extract_metadata(rows)
        if metadata.statement_start_date is None:
            warnings.append("Could not detect date range")

        # Parse transactions
        raw_transactions = self._parse_rows(rows, warnings)

        if not raw_transactions:
            warnings.append("No transactions extracted")

        logger.info(
            "Extracted %d transactions from %s",
            len(raw_transactions), csv_path.name,
        )

        return ParsedStatement(
            source_file_hash=file_hash,
            source_file_path=str(csv_path),
            metadata=metadata,
            raw_transactions=raw_transactions,
            extracted_text=full_text,
            warnings=warnings,
            parser_name=self.name,
            parser_version=self.version,
        )

    def _extract_metadata(self, rows: list[dict[str, str]]) -> StatementMetadata:
        """Extract metadata from CSV rows (date range, etc.)."""
        dates: list[date] = []
        for row in rows:
            d = self._parse_date(row.get("Date", ""))
            if d:
                dates.append(d)

        start_date = min(dates) if dates else None
        end_date = max(dates) if dates else None

        return StatementMetadata(
            institution="amex",
            account_name="credit",
            account_type="credit",
            statement_start_date=start_date,
            statement_end_date=end_date,
        )

    def _parse_rows(
        self, rows: list[dict[str, str]], warnings: list[str]
    ) -> list[RawTransaction]:
        """Parse CSV rows into RawTransaction objects."""
        transactions: list[RawTransaction] = []

        for i, row in enumerate(rows):
            date_str = row.get("Date", "").strip()
            description = row.get("Description", "").strip()
            amount_str = row.get("Amount", "").strip()
            category = row.get("Category", "").strip()

            if not date_str or not amount_str:
                continue

            # Clean up description
            description = normalize_whitespace(description)

            # Determine direction from amount sign
            # Amex: positive = purchase (debit), negative = payment/credit
            try:
                amount_val = Decimal(amount_str)
            except Exception:
                warnings.append(f"Row {i + 2}: unparseable amount '{amount_str}'")
                continue

            if amount_val < 0:
                direction = Direction.CREDIT
                # Store the absolute value; normalizer will apply sign
                amount_str = str(abs(amount_val))
            else:
                direction = Direction.DEBIT
                amount_str = str(amount_val)

            section = category if category else None

            transactions.append(
                RawTransaction(
                    date_str=date_str,
                    description=description,
                    amount_str=amount_str,
                    direction=direction,
                    section=section,
                    reference_number=row.get("Reference", "").strip("' ") or None,
                )
            )

        return transactions

    @staticmethod
    def _parse_date(date_str: str) -> date | None:
        """Parse MM/DD/YYYY date."""
        try:
            return datetime.strptime(date_str.strip(), "%m/%d/%Y").date()
        except (ValueError, AttributeError):
            return None
