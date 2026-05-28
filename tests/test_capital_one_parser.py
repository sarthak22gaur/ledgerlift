"""Tests for the Capital One credit card PDF parser."""

from __future__ import annotations

import textwrap
from datetime import date
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import pytest

from ledgerlift.models import Direction
from ledgerlift.parsers.capital_one_credit_pdf import CapitalOneCreditPDFParser


@pytest.fixture
def sample_c1_text() -> str:
    """Sample Capital One Venture X credit card statement text."""
    return textwrap.dedent("""\
        Venture X Card | Visa Infinite ending in 9000

        Feb 14, 2025 - Mar 16, 2025 | 31 days in Billing Cycle

        Account Summary
        Previous Balance $1,250.00
        Payments, Credits - $530.00
        Transactions $2,581.52
        Fees $0.00
        Interest Charged $0.00
        New Balance $3,301.52
        Credit Limit $25,000.00
        Available Credit $21,698.48

        --- PAGE BREAK ---

        JOHN DOE #9000: Payments, Credits and Adjustments

        Feb 15 Feb 16 ONLINE PAYMENT THANK YOU - $280.00
        Feb 28 Mar 1 REFUND FROM AMAZON.COM - $250.00

        JOHN DOE #9000: Transactions

        Feb 18 Feb 19 WHOLE FOODS MARKET #1234 $85.01
        Feb 20 Feb 21 AMAZON.COM*AB1CD2EF3 AMZN.COM/BILLWA $49.99
        Feb 24 Feb 25 PADDLE.NET* ALFRED APPPADDLE.COMNY $81.01
        $59.00
        GBP
        0.728305148 Exchange Rate
        Mar 1 Mar 2 UBER EATS UBER EATS $32.50
        Mar 5 Mar 6 SPOTIFY USA $14.99

        JOHN DOE #9000: Total Transactions $2,581.52
        Total Transactions for This Period $2,581.52

        --- PAGE BREAK ---

        Transactions (Continued)

        Mar 7 Mar 8 NETFLIX.COM $22.99
        Mar 10 Mar 11 STARBUCKS STORE 12345 $7.50
        Mar 14 Mar 15 SHELL OIL 57431 $55.00

        JOHN DOE #9000: Total Transactions $2,581.52
        Total Transactions for This Period $2,581.52

        Fees
        Total Fees for This Period $0.00

        Interest Charged
        Total Interest for This Period $0.00
    """)


@pytest.fixture
def sample_c1_text_no_credits() -> str:
    """Sample with only debit transactions (no payments section)."""
    return textwrap.dedent("""\
        Venture X Card | Visa Infinite ending in 9000

        Jan 14, 2025 - Feb 13, 2025 | 31 days in Billing Cycle

        Account Summary
        Previous Balance $500.00
        Payments, Credits - $0.00
        Transactions $100.00
        Fees $0.00
        Interest Charged $0.00
        New Balance $600.00

        --- PAGE BREAK ---

        JOHN DOE #9000: Transactions

        Jan 20 Jan 21 COFFEE SHOP $5.50
        Jan 25 Jan 26 GROCERY STORE $94.50

        Total Transactions for This Period $100.00

        Fees
        Total Fees for This Period $0.00

        Interest Charged
        Total Interest for This Period $0.00
    """)


class TestCapitalOneCreditParser:
    def setup_method(self) -> None:
        self.parser = CapitalOneCreditPDFParser()

    @patch("ledgerlift.parsers.capital_one_credit_pdf.extract_text_pages")
    def test_parse_basic_statement(
        self, mock_extract: object, sample_c1_text: str
    ) -> None:
        mock_extract.return_value = [sample_c1_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        assert result.source_file_hash == "fakehash123"
        assert result.parser_name == "capital_one_credit_pdf"
        assert result.metadata.institution == "capitalone"
        assert result.metadata.account_name == "credit"
        assert result.metadata.account_type == "credit"

    @patch("ledgerlift.parsers.capital_one_credit_pdf.extract_text_pages")
    def test_statement_period(
        self, mock_extract: object, sample_c1_text: str
    ) -> None:
        mock_extract.return_value = [sample_c1_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        assert result.metadata.statement_start_date == date(2025, 2, 14)
        assert result.metadata.statement_end_date == date(2025, 3, 16)

    @patch("ledgerlift.parsers.capital_one_credit_pdf.extract_text_pages")
    def test_account_number_extraction(
        self, mock_extract: object, sample_c1_text: str
    ) -> None:
        mock_extract.return_value = [sample_c1_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        assert result.metadata.account_number_last4 == "9000"

    @patch("ledgerlift.parsers.capital_one_credit_pdf.extract_text_pages")
    def test_balance_extraction(
        self, mock_extract: object, sample_c1_text: str
    ) -> None:
        mock_extract.return_value = [sample_c1_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        assert result.metadata.beginning_balance == Decimal("1250.00")
        assert result.metadata.ending_balance == Decimal("3301.52")

    @patch("ledgerlift.parsers.capital_one_credit_pdf.extract_text_pages")
    def test_transaction_count(
        self, mock_extract: object, sample_c1_text: str
    ) -> None:
        mock_extract.return_value = [sample_c1_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        # 2 credits + 5 debits on page 2 + 3 debits on page 3 = 10 total
        assert len(result.raw_transactions) == 10

    @patch("ledgerlift.parsers.capital_one_credit_pdf.extract_text_pages")
    def test_credits_are_direction_credit(
        self, mock_extract: object, sample_c1_text: str
    ) -> None:
        mock_extract.return_value = [sample_c1_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        credits = [
            t for t in result.raw_transactions
            if t.direction == Direction.CREDIT
        ]
        assert len(credits) == 2

        # Check descriptions
        descriptions = {c.description for c in credits}
        assert "ONLINE PAYMENT THANK YOU" in descriptions
        assert "REFUND FROM AMAZON.COM" in descriptions

    @patch("ledgerlift.parsers.capital_one_credit_pdf.extract_text_pages")
    def test_debits_are_direction_debit(
        self, mock_extract: object, sample_c1_text: str
    ) -> None:
        mock_extract.return_value = [sample_c1_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        debits = [
            t for t in result.raw_transactions
            if t.direction == Direction.DEBIT
        ]
        assert len(debits) == 8

    @patch("ledgerlift.parsers.capital_one_credit_pdf.extract_text_pages")
    def test_credit_amounts_correct(
        self, mock_extract: object, sample_c1_text: str
    ) -> None:
        mock_extract.return_value = [sample_c1_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        payment = [
            t for t in result.raw_transactions
            if "ONLINE PAYMENT" in t.description
        ]
        assert len(payment) == 1
        assert payment[0].amount_str == "280.00"
        assert payment[0].direction == Direction.CREDIT

    @patch("ledgerlift.parsers.capital_one_credit_pdf.extract_text_pages")
    def test_debit_amounts_correct(
        self, mock_extract: object, sample_c1_text: str
    ) -> None:
        mock_extract.return_value = [sample_c1_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        whole_foods = [
            t for t in result.raw_transactions
            if "WHOLE FOODS" in t.description
        ]
        assert len(whole_foods) == 1
        assert whole_foods[0].amount_str == "85.01"
        assert whole_foods[0].direction == Direction.DEBIT

    @patch("ledgerlift.parsers.capital_one_credit_pdf.extract_text_pages")
    def test_foreign_currency_handled(
        self, mock_extract: object, sample_c1_text: str
    ) -> None:
        """Foreign currency extra lines should not be treated as transactions."""
        mock_extract.return_value = [sample_c1_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        # The PADDLE.NET transaction should exist with USD amount
        paddle = [
            t for t in result.raw_transactions
            if "PADDLE" in t.description
        ]
        assert len(paddle) == 1
        assert paddle[0].amount_str == "81.01"

        # No transaction should have "GBP" or "Exchange Rate" in description
        for txn in result.raw_transactions:
            assert "GBP" not in txn.description
            assert "Exchange Rate" not in txn.description

    @patch("ledgerlift.parsers.capital_one_credit_pdf.extract_text_pages")
    def test_multipage_continuation(
        self, mock_extract: object, sample_c1_text: str
    ) -> None:
        """Transactions (Continued) on subsequent pages should be parsed."""
        mock_extract.return_value = [sample_c1_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        # NETFLIX, STARBUCKS, SHELL are on the continued page
        netflix = [
            t for t in result.raw_transactions
            if "NETFLIX" in t.description
        ]
        assert len(netflix) == 1
        assert netflix[0].direction == Direction.DEBIT

        starbucks = [
            t for t in result.raw_transactions
            if "STARBUCKS" in t.description
        ]
        assert len(starbucks) == 1

    @patch("ledgerlift.parsers.capital_one_credit_pdf.extract_text_pages")
    def test_date_str_contains_both_dates(
        self, mock_extract: object, sample_c1_text: str
    ) -> None:
        """date_str should contain both trans date and post date."""
        mock_extract.return_value = [sample_c1_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        payment = [
            t for t in result.raw_transactions
            if "ONLINE PAYMENT" in t.description
        ]
        assert len(payment) == 1
        assert "|" in payment[0].date_str
        assert "Feb 15" in payment[0].date_str
        assert "Feb 16" in payment[0].date_str

    @patch("ledgerlift.parsers.capital_one_credit_pdf.extract_text_pages")
    def test_empty_pdf_raises(self, mock_extract: object) -> None:
        mock_extract.return_value = [""]

        from ledgerlift.parsers.base import ParseError

        with pytest.raises(ParseError):
            self.parser.parse(Path("/fake/empty.pdf"), "emptyhash")

    @patch("ledgerlift.parsers.capital_one_credit_pdf.extract_text_pages")
    def test_no_text_raises(self, mock_extract: object) -> None:
        mock_extract.return_value = []

        from ledgerlift.parsers.base import ParseError

        with pytest.raises(ParseError):
            self.parser.parse(Path("/fake/empty.pdf"), "emptyhash")

    @patch("ledgerlift.parsers.capital_one_credit_pdf.extract_text_pages")
    def test_no_credits_statement(
        self, mock_extract: object, sample_c1_text_no_credits: str
    ) -> None:
        """Statement with only debit transactions should work."""
        mock_extract.return_value = [sample_c1_text_no_credits]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        assert len(result.raw_transactions) == 2
        for txn in result.raw_transactions:
            assert txn.direction == Direction.DEBIT


