"""Tests for the SoFi Bank PDF parser."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import pytest

from ledgerlift.models import Direction
from ledgerlift.parsers.sofi_pdf import SoFiPDFParser


SAMPLE_SOFI_PAGE1 = """Primary Account Holder Address Account Number
John Doe 123 Main St 411043124567
Member since May 5, 2025 Monthly Statement Period
Aug 1, 2025 - Aug 31, 2025
Apt 100
Anytown, CA 90210
Checking Account - 4567
Current Balance Current Interest Rate1 Monthly Interest Paid1
$300.35 0.50% $0.13
as of Aug 31, 2025
Beginning Balance Annual Percentage Yield Earned1 Year-to-date Interest Paid1
$300.22 0.51% $0.35
as of Aug 1, 2025
Current balances include the amount of interest paid.
Transaction Details
Balances below are the total funds resulting from the transaction(s) posted on that day.
Checking Account - 4567
DATE TYPE DESCRIPTION AMOUNT BALANCE
Aug 31, 2025 Interest Earned Interest earned $0.13 $300.35
Transaction ID: 16-1
Contact Information
Website Mailing Address Contact Us
www.sofi.com SoFi Bank, N.A. (855) 456-SOFI (7634)"""

SAMPLE_SOFI_PAGE2 = """Important Information
SoFi Insured Deposit Program
For participants in the SoFi Insured Deposit Program..."""

SAMPLE_SOFI_SAVINGS_PAGE = """Primary Account Holder Address Account Number
John Doe 123 Main St 310054398901
Member since May 5, 2025 Monthly Statement Period
Aug 1, 2025 - Aug 31, 2025
Apt 100
Anytown, CA 90210
Savings Account - 8901
Current Balance Current Interest Rate1 Monthly Interest Paid1
$8,101.84 3.74% $22.41
as of Aug 31, 2025
Beginning Balance Annual Percentage Yield Earned1 Year-to-date Interest Paid1
$6,579.43 3.80% $62.29
as of Aug 1, 2025
Current balances include the amount of interest paid.
Transaction Details
Balances below are the total funds resulting from the transaction(s) posted on that day.
Savings Account - 8901
DATE TYPE DESCRIPTION AMOUNT BALANCE
Aug 31, 2025 Interest Earned Interest earned $22.41 $8,101.84
Transaction ID: 25-1
Aug 29, 2025 Direct Deposit GUSTO PAY 998735 $750.00 $8,079.43
Transaction ID: 24-277188001
Aug 15, 2025 Direct Deposit GUSTO PAY 455291 $750.00 $7,329.43
Transaction ID: 23-293926001
Contact Information
Website Mailing Address Contact Us
www.sofi.com SoFi Bank, N.A. (855) 456-SOFI (7634)"""


class TestSoFiParser:
    def setup_method(self) -> None:
        self.parser = SoFiPDFParser()

    @patch("ledgerlift.parsers.sofi_pdf.extract_text_pages")
    def test_parse_checking_and_savings(self, mock_extract: object) -> None:
        mock_extract.return_value = [
            SAMPLE_SOFI_PAGE1,
            SAMPLE_SOFI_PAGE2,
            SAMPLE_SOFI_SAVINGS_PAGE,
        ]

        result = self.parser.parse(Path("/fake/sofi.pdf"), "fakehash")

        assert result.metadata.institution == "sofi"
        assert result.metadata.account_name == "bank"
        assert result.metadata.statement_start_date == date(2025, 8, 1)
        assert result.metadata.statement_end_date == date(2025, 8, 31)

        # Checking + savings transactions
        assert len(result.raw_transactions) == 4  # 1 checking + 3 savings

    @patch("ledgerlift.parsers.sofi_pdf.extract_text_pages")
    def test_checking_transaction(self, mock_extract: object) -> None:
        mock_extract.return_value = [SAMPLE_SOFI_PAGE1]

        result = self.parser.parse(Path("/fake/sofi.pdf"), "fakehash")

        checking_txns = [t for t in result.raw_transactions if t.section == "checking"]
        assert len(checking_txns) == 1
        txn = checking_txns[0]
        assert txn.date_str == "Aug 31, 2025"
        assert "Interest Earned" in txn.description
        assert txn.amount_str == "0.13"
        assert txn.direction == Direction.CREDIT
        assert txn.reference_number == "16-1"

    @patch("ledgerlift.parsers.sofi_pdf.extract_text_pages")
    def test_savings_transactions_included(self, mock_extract: object) -> None:
        """Savings transactions are included with section='savings'."""
        mock_extract.return_value = [SAMPLE_SOFI_SAVINGS_PAGE]

        result = self.parser.parse(Path("/fake/sofi.pdf"), "fakehash")

        assert len(result.raw_transactions) == 3
        for txn in result.raw_transactions:
            assert txn.section == "savings"

    @patch("ledgerlift.parsers.sofi_pdf.extract_text_pages")
    def test_negative_amount_debit(self, mock_extract: object) -> None:
        """Test that negative amounts are parsed as debits."""
        page_with_debit = """Checking Account - 4567
DATE TYPE DESCRIPTION AMOUNT BALANCE
Jun 13, 2025 Direct Payment Wealthfront EDI PYMNTS -$5,500.00 $4,295.98
Transaction ID: 15-261201001
Contact Information"""
        mock_extract.return_value = [page_with_debit]

        result = self.parser.parse(Path("/fake/sofi.pdf"), "fakehash")

        assert len(result.raw_transactions) == 1
        txn = result.raw_transactions[0]
        assert txn.direction == Direction.DEBIT
        assert txn.amount_str == "-5500.00"
        assert "Wealthfront EDI PYMNTS" in txn.description

    @patch("ledgerlift.parsers.sofi_pdf.extract_text_pages")
    def test_empty_transaction_section(self, mock_extract: object) -> None:
        """Test statement with no transactions (e.g., first month with $0 balance)."""
        page_empty = """Monthly Statement Period
May 5, 2025 - May 31, 2025
Checking Account - 4567
DATE TYPE DESCRIPTION AMOUNT BALANCE
Contact Information"""
        mock_extract.return_value = [page_empty]

        result = self.parser.parse(Path("/fake/sofi.pdf"), "fakehash")

        assert len(result.raw_transactions) == 0
        assert any("No transactions" in w for w in result.warnings)

    @patch("ledgerlift.parsers.sofi_pdf.extract_text_pages")
    def test_account_numbers_detected(self, mock_extract: object) -> None:
        mock_extract.return_value = [
            SAMPLE_SOFI_PAGE1,
            SAMPLE_SOFI_SAVINGS_PAGE,
        ]

        result = self.parser.parse(Path("/fake/sofi.pdf"), "fakehash")

        # Should detect both account last-4 digits
        assert result.metadata.account_number_last4 is not None
        assert "4567" in result.metadata.account_number_last4
        assert "8901" in result.metadata.account_number_last4

    @patch("ledgerlift.parsers.sofi_pdf.extract_text_pages")
    def test_bonus_transaction(self, mock_extract: object) -> None:
        page_with_bonus = """Checking Account - 4567
DATE TYPE DESCRIPTION AMOUNT BALANCE
Jun 10, 2025 Bonus Money Promo Bonus $300.00 $300.00
Transaction ID: 11-104809002
Contact Information"""
        mock_extract.return_value = [page_with_bonus]

        result = self.parser.parse(Path("/fake/sofi.pdf"), "fakehash")

        assert len(result.raw_transactions) == 1
        txn = result.raw_transactions[0]
        assert "Bonus Money Promo Bonus" in txn.description
        assert txn.amount_str == "300.00"
        assert txn.direction == Direction.CREDIT

    @patch("ledgerlift.parsers.sofi_pdf.extract_text_pages")
    def test_deposit_transaction(self, mock_extract: object) -> None:
        page_with_deposit = """Checking Account - 4567
DATE TYPE DESCRIPTION AMOUNT BALANCE
May 6, 2025 Deposit GUSTO ACCTVERIFY $0.01 $0.01
Transaction ID: 6-212249001
Contact Information"""
        mock_extract.return_value = [page_with_deposit]

        result = self.parser.parse(Path("/fake/sofi.pdf"), "fakehash")

        assert len(result.raw_transactions) == 1
        txn = result.raw_transactions[0]
        assert "Deposit GUSTO ACCTVERIFY" in txn.description
        assert txn.amount_str == "0.01"
        assert txn.direction == Direction.CREDIT


class TestSoFiDateParsing:
    """Test that SoFi's Mon DD, YYYY dates work through the normalizer."""

    def test_parse_date_mon_dd_yyyy(self) -> None:
        from ledgerlift.utils.dates import parse_date_mon_dd_yyyy

        assert parse_date_mon_dd_yyyy("Aug 31, 2025") == date(2025, 8, 31)
        assert parse_date_mon_dd_yyyy("Jan 1, 2026") == date(2026, 1, 1)
        assert parse_date_mon_dd_yyyy("May 5, 2025") == date(2025, 5, 5)
        assert parse_date_mon_dd_yyyy("invalid") is None

    def test_transaction_date_parsing(self) -> None:
        from ledgerlift.utils.dates import parse_transaction_date

        # Mon DD, YYYY (SoFi) should work via parse_transaction_date
        assert parse_transaction_date("Aug 31, 2025", 2025) == date(2025, 8, 31)
        assert parse_transaction_date("Jun 13, 2025", 2025) == date(2025, 6, 13)

        # Should not break existing formats
        assert parse_transaction_date("08/31/2025", 2025) == date(2025, 8, 31)
        assert parse_transaction_date("08/31", 2025) == date(2025, 8, 31)
        assert parse_transaction_date("Aug 31", 2025) == date(2025, 8, 31)
