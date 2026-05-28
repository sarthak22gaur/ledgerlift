"""Tests for the Chase credit card PDF parser."""

from __future__ import annotations

import textwrap
from datetime import date
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import pytest

from ledgerlift.models import Direction
from ledgerlift.parsers.chase_credit_pdf import ChaseCreditPDFParser


SAMPLE_CHASE_CC_TEXT = textwrap.dedent("""\
    Account Number: XXXX XXXX XXXX 9999
    Previous Balance $500.00
    Payment, Credits -$200.00
    Purchases +$350.00
    New Balance $650.00
    Opening/Closing Date 01/26/25 - 02/25/25
    Credit Access Line $12,700

    --- PAGE BREAK ---

    AACCCCOOUUNNTT AACCTTIIVVIITTYY
    Date of
    Transaction Merchant Name or Transaction Description $ Amount
    PAYMENTS AND OTHER CREDITS
    02/15 AUTOMATIC PAYMENT - THANK YOU -200.00
    PURCHASE
    02/01 COSTCO WHSE #0401 SAN DIEGO CA 85.23
    02/05 DD *DOORDASH CHIPOTL 855-431-0459 CA 18.54
    02/10 AMAZON MKTPL*AB1CD Amzn.com/bill WA 45.00
    02/14 UBER EATS HELP.UBER.COM CA 22.50
    02/20 FANDANGO * FANDANGO.COM CA 14.98
    02/22 SQ *THE NOBLE CHEF SAN DIEGO CA 58.00
    02/24 LYFT *1 RIDE 02-23 HELP.LYFT.COM CA 47.75
    02/25 SPOTIFY USA NEW YORK NY 10.99
    FEES CHARGED
    02/01 ANNUAL MEMBERSHIP FEE 47.00
    2025 Totals Year-to-Date
    Total fees charged in 2025 $95.00
    Total interest charged in 2025 $0.00
    IINNTTEERREESSTT CCHHAARRGGEESS
    PURCHASES
    Purchases 27.24%(v)(d) - 0 - - 0 -
    JOHN DOE Page2 of 2 Statement Date: 02/25/25
""")


@pytest.fixture
def sample_chase_cc_text() -> str:
    return SAMPLE_CHASE_CC_TEXT


class TestChaseCreditParser:
    def setup_method(self) -> None:
        self.parser = ChaseCreditPDFParser()

    @patch("ledgerlift.parsers.chase_credit_pdf.extract_text_pages")
    def test_parse_basic(self, mock_extract: object, sample_chase_cc_text: str) -> None:
        mock_extract.return_value = [sample_chase_cc_text]
        result = self.parser.parse(Path("/fake/stmt.pdf"), "hash123")

        assert result.metadata.institution == "chase"
        assert result.metadata.account_name == "credit"
        assert result.metadata.account_type == "credit"
        assert len(result.raw_transactions) == 10  # 1 payment + 8 purchases + 1 fee

    @patch("ledgerlift.parsers.chase_credit_pdf.extract_text_pages")
    def test_statement_period(self, mock_extract: object, sample_chase_cc_text: str) -> None:
        mock_extract.return_value = [sample_chase_cc_text]
        result = self.parser.parse(Path("/fake/stmt.pdf"), "hash123")

        assert result.metadata.statement_start_date == date(2025, 1, 26)
        assert result.metadata.statement_end_date == date(2025, 2, 25)

    @patch("ledgerlift.parsers.chase_credit_pdf.extract_text_pages")
    def test_account_number(self, mock_extract: object, sample_chase_cc_text: str) -> None:
        mock_extract.return_value = [sample_chase_cc_text]
        result = self.parser.parse(Path("/fake/stmt.pdf"), "hash123")

        assert result.metadata.account_number_last4 == "9999"

    @patch("ledgerlift.parsers.chase_credit_pdf.extract_text_pages")
    def test_balances(self, mock_extract: object, sample_chase_cc_text: str) -> None:
        mock_extract.return_value = [sample_chase_cc_text]
        result = self.parser.parse(Path("/fake/stmt.pdf"), "hash123")

        assert result.metadata.beginning_balance == Decimal("500.00")
        assert result.metadata.ending_balance == Decimal("650.00")

    @patch("ledgerlift.parsers.chase_credit_pdf.extract_text_pages")
    def test_payment_is_credit(self, mock_extract: object, sample_chase_cc_text: str) -> None:
        mock_extract.return_value = [sample_chase_cc_text]
        result = self.parser.parse(Path("/fake/stmt.pdf"), "hash123")

        credits = [t for t in result.raw_transactions if t.direction == Direction.CREDIT]
        assert len(credits) == 1
        assert "AUTOMATIC PAYMENT" in credits[0].description
        assert credits[0].amount_str == "200.00"

    @patch("ledgerlift.parsers.chase_credit_pdf.extract_text_pages")
    def test_purchases_are_debits(self, mock_extract: object, sample_chase_cc_text: str) -> None:
        mock_extract.return_value = [sample_chase_cc_text]
        result = self.parser.parse(Path("/fake/stmt.pdf"), "hash123")

        debits = [t for t in result.raw_transactions if t.direction == Direction.DEBIT]
        assert len(debits) == 9  # 8 purchases + 1 fee

    @patch("ledgerlift.parsers.chase_credit_pdf.extract_text_pages")
    def test_fee_is_debit(self, mock_extract: object, sample_chase_cc_text: str) -> None:
        mock_extract.return_value = [sample_chase_cc_text]
        result = self.parser.parse(Path("/fake/stmt.pdf"), "hash123")

        fees = [t for t in result.raw_transactions if "ANNUAL" in t.description]
        assert len(fees) == 1
        assert fees[0].direction == Direction.DEBIT
        assert fees[0].amount_str == "47.00"

    @patch("ledgerlift.parsers.chase_credit_pdf.extract_text_pages")
    def test_no_ytd_or_interest_in_transactions(
        self, mock_extract: object, sample_chase_cc_text: str
    ) -> None:
        mock_extract.return_value = [sample_chase_cc_text]
        result = self.parser.parse(Path("/fake/stmt.pdf"), "hash123")

        for t in result.raw_transactions:
            assert "Year-to-Date" not in t.description
            assert "interest" not in t.description.lower()
            assert "27.24%" not in t.description

    @patch("ledgerlift.parsers.chase_credit_pdf.extract_text_pages")
    def test_normalization_end_to_end(
        self, mock_extract: object, sample_chase_cc_text: str
    ) -> None:
        from ledgerlift.normalize import normalize_statement

        mock_extract.return_value = [sample_chase_cc_text]
        result = self.parser.parse(Path("/fake/stmt.pdf"), "hash123")
        normalized = normalize_statement(result)

        assert len(normalized) == 10

        payment = [t for t in normalized if "PAYMENT" in t.description_raw]
        assert len(payment) == 1
        assert payment[0].amount > 0
        assert payment[0].direction == Direction.CREDIT

        purchases = [t for t in normalized if t.direction == Direction.DEBIT]
        assert all(t.amount < 0 for t in purchases)


