"""Tests for the Chase checking PDF parser."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import pytest

from ledgerlift.models import Direction
from ledgerlift.parsers.chase_checking_pdf import ChaseCheckingPDFParser


class TestChaseCheckingParser:
    def setup_method(self) -> None:
        self.parser = ChaseCheckingPDFParser()

    @patch("ledgerlift.parsers.chase_checking_pdf.extract_text_pages")
    def test_parse_basic_statement(
        self, mock_extract: object, sample_chase_text: str
    ) -> None:
        mock_extract.return_value = [sample_chase_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        assert result.source_file_hash == "fakehash123"
        assert result.parser_name == "chase_checking_pdf"
        assert result.metadata.institution == "chase"
        assert result.metadata.account_name == "checking"

        # Should have found statement period
        assert result.metadata.statement_start_date == date(2023, 1, 1)
        assert result.metadata.statement_end_date == date(2023, 1, 31)

        # Should have extracted transactions
        assert len(result.raw_transactions) > 0

    @patch("ledgerlift.parsers.chase_checking_pdf.extract_text_pages")
    def test_deposits_are_credits(
        self, mock_extract: object, sample_chase_text: str
    ) -> None:
        mock_extract.return_value = [sample_chase_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        deposits = [t for t in result.raw_transactions if t.direction == Direction.CREDIT]
        assert len(deposits) == 3  # 3 deposits in sample

        for dep in deposits:
            assert dep.description
            # Deposit amounts should be positive in the raw amount_str
            assert not dep.amount_str.startswith("-")

    @patch("ledgerlift.parsers.chase_checking_pdf.extract_text_pages")
    def test_multiline_description(
        self, mock_extract: object, sample_chase_text: str
    ) -> None:
        mock_extract.return_value = [sample_chase_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        # The COMCAST entry has a continuation line "Internet Service"
        comcast = [
            t for t in result.raw_transactions if "COMCAST" in t.description
        ]
        assert len(comcast) == 1
        assert "Internet Service" in comcast[0].description

    @patch("ledgerlift.parsers.chase_checking_pdf.extract_text_pages")
    def test_account_number_extraction(
        self, mock_extract: object, sample_chase_text: str
    ) -> None:
        mock_extract.return_value = [sample_chase_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        assert result.metadata.account_number_last4 == "1234"

    @patch("ledgerlift.parsers.chase_checking_pdf.extract_text_pages")
    def test_balance_extraction(
        self, mock_extract: object, sample_chase_text: str
    ) -> None:
        mock_extract.return_value = [sample_chase_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        assert result.metadata.beginning_balance == Decimal("5000.00")
        assert result.metadata.ending_balance == Decimal("5762.49")

    @patch("ledgerlift.parsers.chase_checking_pdf.extract_text_pages")
    def test_amounts_are_correct(
        self, mock_extract: object, sample_chase_text: str
    ) -> None:
        """Verify amounts are the transaction amount, not the running balance."""
        mock_extract.return_value = [sample_chase_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        # Find the ACME payroll deposit
        acme = [t for t in result.raw_transactions if "ACME" in t.description]
        assert len(acme) == 1
        assert acme[0].amount_str == "2,500.00"

        # Find the ATM withdrawal
        atm = [t for t in result.raw_transactions if "ATM WITHDRAWAL" in t.description]
        assert len(atm) == 1
        assert atm[0].amount_str == "-200.00"

    @patch("ledgerlift.parsers.chase_checking_pdf.extract_text_pages")
    def test_no_boilerplate_in_descriptions(
        self, mock_extract: object, sample_chase_text: str
    ) -> None:
        """Verify no disclosure text leaks into transaction descriptions."""
        mock_extract.return_value = [sample_chase_text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "fakehash123")

        for txn in result.raw_transactions:
            assert "*start*" not in txn.description
            assert "*end*" not in txn.description
            assert "IN CASE OF ERRORS" not in txn.description
            assert "Overdraft" not in txn.description

    @patch("ledgerlift.parsers.chase_checking_pdf.extract_text_pages")
    def test_empty_pdf_raises(self, mock_extract: object) -> None:
        mock_extract.return_value = [""]

        from ledgerlift.parsers.base import ParseError

        with pytest.raises(ParseError):
            self.parser.parse(Path("/fake/empty.pdf"), "emptyhash")

    @patch("ledgerlift.parsers.chase_checking_pdf.extract_text_pages")
    def test_no_text_raises(self, mock_extract: object) -> None:
        mock_extract.return_value = []

        from ledgerlift.parsers.base import ParseError

        with pytest.raises(ParseError):
            self.parser.parse(Path("/fake/empty.pdf"), "emptyhash")


class TestChaseParserEdgeCases:
    def setup_method(self) -> None:
        self.parser = ChaseCheckingPDFParser()

    @patch("ledgerlift.parsers.chase_checking_pdf.extract_text_pages")
    def test_no_transactions_warns(self, mock_extract: object) -> None:
        mock_extract.return_value = [
            "JPMorgan Chase Bank\nSome header text\nNo transaction data here\n"
        ]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "hash123")

        assert any("No transaction" in w for w in result.warnings)

    @patch("ledgerlift.parsers.chase_checking_pdf.extract_text_pages")
    def test_page_break_does_not_contaminate(self, mock_extract: object) -> None:
        """Simulate a page break mid-transaction-section."""
        page1 = (
            "*start*transaction detail\n"
            "TRANSACTION DETAIL\n"
            "DATE DESCRIPTION AMOUNT BALANCE\n"
            "Beginning Balance $1,000.00\n"
            "01/05 DIRECT DEP ACME CORP 500.00 1,500.00\n"
            "*end*transaction detail"
        )
        page2 = (
            "January 1, 2023 through January 31, 2023\n"
            "Account Number:\n"
            "000000001231234\n"
            "*start*transaction detail\n"
            "(continued)\n"
            "TRANSACTION DETAIL\n"
            "DATE DESCRIPTION AMOUNT BALANCE\n"
            "01/10 PURCHASE AT STORE -50.00 1,450.00\n"
            "*end*transaction detail\n"
            "*start*dre portrait disclosure message area\n"
            "IN CASE OF ERRORS OR QUESTIONS...\n"
            "*end*dre portrait disclosure message area"
        )
        mock_extract.return_value = [page1, page2]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "hash456")

        assert len(result.raw_transactions) == 2
        assert result.raw_transactions[0].amount_str == "500.00"
        assert result.raw_transactions[1].amount_str == "-50.00"

        # No boilerplate contamination
        for txn in result.raw_transactions:
            assert "IN CASE OF ERRORS" not in txn.description

    @patch("ledgerlift.parsers.chase_checking_pdf.extract_text_pages")
    def test_direction_inferred_from_amount_sign(self, mock_extract: object) -> None:
        """When there are no sub-headers, direction comes from amount sign."""
        text = (
            "*start*transaction detail\n"
            "TRANSACTION DETAIL\n"
            "DATE DESCRIPTION AMOUNT BALANCE\n"
            "01/05 DEPOSIT FROM EMPLOYER 1,000.00 2,000.00\n"
            "01/10 CARD PURCHASE STORE -50.00 1,950.00\n"
            "*end*transaction detail"
        )
        mock_extract.return_value = [text]

        result = self.parser.parse(Path("/fake/stmt.pdf"), "hash789")

        assert len(result.raw_transactions) == 2
        assert result.raw_transactions[0].direction == Direction.CREDIT
        assert result.raw_transactions[1].direction == Direction.DEBIT
