"""Tests for the Amex credit card CSV parser."""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from ledgerlift.models import Direction
from ledgerlift.parsers.amex_credit_csv import AmexCreditCSVParser, is_amex_csv


SAMPLE_AMEX_CSV = textwrap.dedent("""\
    Date,Description,Amount,Extended Details,Appears On Your Statement As,Address,City/State,Zip Code,Country,Reference,Category
    02/22/2026,CRUNCHYROLL.COM COPPELL TX,11.99,DETAILS,CRUNCHYROLL.COM,123 MAIN,COPPELL TX,75019,UNITED STATES,'123',Entertainment-General Events
    02/19/2026,AUTOPAY PAYMENT - THANK YOU,-1564.31,,,,,,,'320261234',
    02/15/2026,COSTCO WHSE #0401 SAN DIEGO CA,85.23,DETAILS,COSTCO,456 ELM,SAN DIEGO CA,92122,UNITED STATES,'456',Merchandise & Supplies-Groceries
    02/10/2026,DD *DOORDASH SAN FRANCISCO CA,18.54,DETAILS,DD *DOORDASH,789 OAK,SAN FRANCISCO CA,94107,UNITED STATES,'789',Restaurant-Restaurant
    01/28/2026,AMAZON MKTPL Amzn.com/bill WA,45.00,DETAILS,AMAZON,SEATTLE,WA,98109,UNITED STATES,'012',Merchandise & Supplies-Internet Purchase
    01/27/2026,UBER EATS HELP.UBER.COM CA,22.50,DETAILS,UBER EATS,SAN FRANCISCO,CA,94103,UNITED STATES,'345',Restaurant-Restaurant
""")


@pytest.fixture
def sample_amex_csv(tmp_path: Path) -> Path:
    """Create a sample Amex CSV file."""
    csv_path = tmp_path / "activity.csv"
    csv_path.write_text(SAMPLE_AMEX_CSV)
    return csv_path


class TestAmexCSVParser:
    def setup_method(self) -> None:
        self.parser = AmexCreditCSVParser()

    def test_parse_basic(self, sample_amex_csv: Path) -> None:
        from ledgerlift.hashing import hash_file

        file_hash = hash_file(sample_amex_csv)
        result = self.parser.parse(sample_amex_csv, file_hash)

        assert result.parser_name == "amex_credit_csv"
        assert result.metadata.institution == "amex"
        assert result.metadata.account_name == "credit"
        assert len(result.raw_transactions) == 6

    def test_statement_period(self, sample_amex_csv: Path) -> None:
        result = self.parser.parse(sample_amex_csv, "hash123")

        from datetime import date

        assert result.metadata.statement_start_date == date(2026, 1, 27)
        assert result.metadata.statement_end_date == date(2026, 2, 22)

    def test_purchases_are_debits(self, sample_amex_csv: Path) -> None:
        result = self.parser.parse(sample_amex_csv, "hash123")

        purchases = [t for t in result.raw_transactions if t.direction == Direction.DEBIT]
        assert len(purchases) == 5  # All except the payment

        for p in purchases:
            # Amount should be stored as positive string (normalizer adds sign)
            assert not p.amount_str.startswith("-")

    def test_payment_is_credit(self, sample_amex_csv: Path) -> None:
        result = self.parser.parse(sample_amex_csv, "hash123")

        credits = [t for t in result.raw_transactions if t.direction == Direction.CREDIT]
        assert len(credits) == 1
        assert "AUTOPAY" in credits[0].description
        assert credits[0].amount_str == "1564.31"

    def test_amounts_correct(self, sample_amex_csv: Path) -> None:
        result = self.parser.parse(sample_amex_csv, "hash123")

        amounts = {t.description[:15]: t.amount_str for t in result.raw_transactions}
        assert amounts["CRUNCHYROLL.COM"] == "11.99"
        assert amounts["COSTCO WHSE #04"] == "85.23"

    def test_categories_in_section(self, sample_amex_csv: Path) -> None:
        result = self.parser.parse(sample_amex_csv, "hash123")

        doordash = [t for t in result.raw_transactions if "DOORDASH" in t.description]
        assert len(doordash) == 1
        assert doordash[0].section == "Restaurant-Restaurant"

    def test_reference_numbers(self, sample_amex_csv: Path) -> None:
        result = self.parser.parse(sample_amex_csv, "hash123")

        refs = [t.reference_number for t in result.raw_transactions if t.reference_number]
        assert len(refs) > 0


class TestAmexCSVDetection:
    def test_is_amex_csv_true(self, sample_amex_csv: Path) -> None:
        assert is_amex_csv(sample_amex_csv) is True

    def test_is_amex_csv_false(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "other.csv"
        csv_path.write_text("Name,Age\nAlice,30\n")
        assert is_amex_csv(csv_path) is False

    def test_is_amex_csv_nonexistent(self, tmp_path: Path) -> None:
        assert is_amex_csv(tmp_path / "nope.csv") is False

    def test_empty_csv(self, tmp_path: Path) -> None:
        csv_path = tmp_path / "empty.csv"
        csv_path.write_text("")
        assert is_amex_csv(csv_path) is False


class TestAmexNormalization:
    """Test that Amex transactions normalize correctly end-to-end."""

    def test_normalize_amex_transactions(self, sample_amex_csv: Path) -> None:
        from ledgerlift.normalize import normalize_statement

        parser = AmexCreditCSVParser()
        result = parser.parse(sample_amex_csv, "hash123")
        normalized = normalize_statement(result)

        assert len(normalized) == 6

        # Payment should be positive (credit)
        payment = [t for t in normalized if "AUTOPAY" in t.description_raw]
        assert len(payment) == 1
        assert payment[0].amount > 0
        assert payment[0].direction == Direction.CREDIT

        # Purchases should be negative (debit)
        purchases = [t for t in normalized if t.direction == Direction.DEBIT]
        assert all(t.amount < 0 for t in purchases)
