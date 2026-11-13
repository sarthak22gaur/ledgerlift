"""Synthetic regression cases for Wealthfront statement layouts."""
from pathlib import Path
from unittest.mock import patch

import pytest

from ledgerlift.models import Direction
from ledgerlift.parsers.wealthfront_cash_pdf import WealthfrontCashPDFParser
from ledgerlift.parsers.wealthfront_greendot_pdf import WealthfrontGreenDotPDFParser
from ledgerlift.reconciliation import reconcile_statement


def parse_cash(activity: str, ending: str = "145.00"):
    text = (
        "Individual Cash Account | January 1 - 31, 2026\n"
        "Starting Balance $100.00\n"
        f"Ending Balance ${ending}\n" + activity
    )
    with patch("ledgerlift.parsers.wealthfront_cash_pdf.extract_text_pages", return_value=[text]):
        return WealthfrontCashPDFParser().parse(Path("/fake/statement.pdf"), "hash")


@pytest.mark.parametrize("initiator", ["", "-- ", "EXAMPLE PAYROLL "])
def test_cash_old_and_new_columns(initiator: str) -> None:
    result = parse_cash(
        "Deposits/Credits to Wealthfront Brokerage\n"
        "Date Method Status Initiator Amount\n"
        f"1/5/2026 ACH Direct Deposit Received {initiator}$50.00\n"
        "Withdrawals/Debits from Wealthfront Brokerage\n"
        "1/8/2026 ACH Direct Withdrawal Disbursed EXAMPLE SHOP -$10.00\n"
        "Transfer between Wealthfront and Program Banks3\n"
        "1/5/2026 Transfer to Program Banks -$50.00\n"
        "INTEREST4\n1/1/2026 December 2025 $5.00\n"
        "Balance and Interest Rate Details\n"
        "1/1/2026 $100.00 3.00% 3.10%"
    )
    assert len(result.raw_transactions) == 3
    assert result.extraction_errors == []
    assert reconcile_statement(result).is_reconciled
    assert result.raw_transactions[1].description == "ACH Direct Withdrawal - EXAMPLE SHOP"
    assert result.raw_transactions[1].direction == Direction.DEBIT
    if "EXAMPLE" in initiator:
        assert result.raw_transactions[0].description == "ACH Direct Deposit - EXAMPLE PAYROLL"
    else:
        assert result.raw_transactions[0].description == "ACH Direct Deposit"


def test_cash_wrapped_method_and_footnotes() -> None:
    result = parse_cash(
        "Deposits/Credits to Wealthfront Brokerage\n"
        "1/5/2026 End of day transfer from Green Received -- $30.00\nDot2\n"
        "1/6/2026 End of day transfer from Green Dot2 Received $20.00\n"
        "Withdrawals/Debits from Wealthfront Brokerage\n"
        "1/8/2026 ACH Direct Withdrawal Disbursed SHOP 123 -$5.00\n",
    )
    assert [t.description for t in result.raw_transactions] == [
        "End of day transfer from Green Dot",
        "End of day transfer from Green Dot",
        "ACH Direct Withdrawal - SHOP 123",
    ]
    assert not result.extraction_errors
    assert reconcile_statement(result).is_reconciled


def test_cash_balanced_unknown_rows_still_fail_extraction() -> None:
    result = parse_cash(
        "Deposits/Credits to Wealthfront Brokerage\n"
        "1/5/2026 Unknown Status $50.00\n"
        "Withdrawals/Debits from Wealthfront Brokerage\n"
        "1/6/2026 Unknown Status -$50.00\n",
        ending="100.00",
    )
    assert len([e for e in result.extraction_errors if "Unrecognized" in e]) == 2
    assert not result.empty_statement
    assert all("Unknown Status" not in e for e in result.extraction_errors)


def test_cash_requires_known_activity_sections_and_period() -> None:
    with patch("ledgerlift.parsers.wealthfront_cash_pdf.extract_text_pages", return_value=["Changed statement format"]):
        result = WealthfrontCashPDFParser().parse(Path("/fake/statement.pdf"), "hash")
    assert "Statement period not detected" in result.extraction_errors
    assert "Expected deposits activity section not detected" in result.extraction_errors
    assert "Expected withdrawals activity section not detected" in result.extraction_errors


def test_cash_explicit_empty_sections() -> None:
    result = parse_cash(
        "Deposits/Credits to Wealthfront Brokerage\nNo Transactions\n"
        "Withdrawals/Debits from Wealthfront Brokerage\nNo Transactions\n",
        ending="100.00",
    )
    assert result.empty_statement
    assert not result.extraction_errors
    assert not result.warnings


def parse_greendot(activity: str, ending: str = "100.00"):
    text = (
        "Jan. 06, 2026 to Feb. 05, 2026\n"
        "Beginning Balance on Jan. 06, 2026 $100.00\n"
        f"Ending Balance on Feb. 05, 2026 ${ending}\n" + activity
    )
    with patch("ledgerlift.parsers.wealthfront_greendot_pdf.extract_text_pages", return_value=[text]):
        return WealthfrontGreenDotPDFParser().parse(Path("/fake/statement.pdf"), "hash")


def test_greendot_explicit_empty_transaction_section() -> None:
    result = parse_greendot("TRANSACTIONS\nNo Transactions\nSWEEP TRANSACTIONS 2\nNo Transactions")
    assert result.empty_statement
    assert not result.warnings
    assert not result.extraction_errors


def test_greendot_empty_notice_in_sweeps_does_not_prove_empty_activity() -> None:
    result = parse_greendot("TRANSACTIONS\nSWEEP TRANSACTIONS 2\nNo Transactions")
    assert not result.empty_statement
    assert result.warnings


def test_greendot_empty_notice_contradicted_by_activity_or_balance() -> None:
    result = parse_greendot("TRANSACTIONS\nNo Transactions\n01/10/2026 SHOP - $10.00\nDebit\nSWEEP TRANSACTIONS", "90.00")
    assert not result.empty_statement
    assert result.extraction_errors
    result = parse_greendot("TRANSACTIONS\nNo Transactions\nSWEEP TRANSACTIONS", "90.00")
    assert not result.empty_statement


def test_greendot_sweep_rows_are_excluded_and_unknown_activity_reported() -> None:
    result = parse_greendot(
        "TRANSACTIONS\n01/10/2026 SHOP - $10.00\nDebit\n"
        "01/11/2026 UNKNOWN ($5.00)\n"
        "SWEEP TRANSACTIONS 2\n01/10/2026 SWEEP + $10.00\n"
        "DATE DESCRIPTION AMOUNT\n01/11/2026 SWEEP + $5.00"
    )
    assert len(result.raw_transactions) == 1
    assert len(result.extraction_errors) == 1
