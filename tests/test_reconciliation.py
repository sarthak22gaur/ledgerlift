"""Tests for statement balance reconciliation."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from ledgerlift.models import Direction, ParsedStatement, RawTransaction, StatementMetadata
from ledgerlift.reconciliation import TOLERANCE, reconcile_statement


def _make_parsed(
    beginning: Decimal | None,
    ending: Decimal | None,
    transactions: list[RawTransaction],
    account_type: str = "checking",
    institution: str = "chase",
    account_name: str = "checking",
) -> ParsedStatement:
    return ParsedStatement(
        source_file_hash="abc123",
        source_file_path="/test.pdf",
        metadata=StatementMetadata(
            institution=institution,
            account_name=account_name,
            account_type=account_type,
            statement_start_date=date(2025, 1, 1),
            statement_end_date=date(2025, 1, 31),
            beginning_balance=beginning,
            ending_balance=ending,
        ),
        raw_transactions=transactions,
        extracted_text="",
        parser_name="test",
        parser_version="0.1.0",
    )


class TestReconcileStatement:
    def test_checking_reconciles(self) -> None:
        """Checking: beginning + credits - debits = ending."""
        txns = [
            RawTransaction(date_str="01/05", description="DEPOSIT", amount_str="1000.00", direction=Direction.CREDIT),
            RawTransaction(date_str="01/10", description="PURCHASE", amount_str="200.00", direction=Direction.DEBIT),
            RawTransaction(date_str="01/15", description="PURCHASE", amount_str="300.00", direction=Direction.DEBIT),
        ]
        parsed = _make_parsed(
            beginning=Decimal("5000.00"),
            ending=Decimal("5500.00"),
            transactions=txns,
        )
        result = reconcile_statement(parsed)
        assert result is not None
        assert result.is_reconciled is True
        assert result.discrepancy == Decimal("0")

    def test_credit_card_reconciles(self) -> None:
        """Credit card: beginning + debits - credits = ending."""
        txns = [
            RawTransaction(date_str="01/05", description="CHARGE", amount_str="500.00", direction=Direction.DEBIT),
            RawTransaction(date_str="01/15", description="PAYMENT", amount_str="200.00", direction=Direction.CREDIT),
        ]
        parsed = _make_parsed(
            beginning=Decimal("1000.00"),
            ending=Decimal("1300.00"),
            transactions=txns,
            account_type="credit",
        )
        result = reconcile_statement(parsed)
        assert result is not None
        assert result.is_reconciled is True

    def test_missing_beginning_balance_returns_none(self) -> None:
        txns = [RawTransaction(date_str="01/05", description="X", amount_str="100.00", direction=Direction.CREDIT)]
        parsed = _make_parsed(beginning=None, ending=Decimal("100"), transactions=txns)
        assert reconcile_statement(parsed) is None

    def test_missing_ending_balance_returns_none(self) -> None:
        txns = [RawTransaction(date_str="01/05", description="X", amount_str="100.00", direction=Direction.CREDIT)]
        parsed = _make_parsed(beginning=Decimal("100"), ending=None, transactions=txns)
        assert reconcile_statement(parsed) is None

    def test_no_transactions_returns_none(self) -> None:
        parsed = _make_parsed(beginning=Decimal("100"), ending=Decimal("100"), transactions=[])
        assert reconcile_statement(parsed) is None

    def test_penny_tolerance_passes(self) -> None:
        """A discrepancy within tolerance should pass."""
        txns = [
            RawTransaction(date_str="01/05", description="DEPOSIT", amount_str="100.00", direction=Direction.CREDIT),
        ]
        # Expected ending: 5000 + 100 = 5100, actual: 5100.01 (within 0.02 tolerance)
        parsed = _make_parsed(
            beginning=Decimal("5000.00"),
            ending=Decimal("5100.01"),
            transactions=txns,
        )
        result = reconcile_statement(parsed)
        assert result is not None
        assert result.is_reconciled is True
        assert abs(result.discrepancy) <= TOLERANCE

    def test_discrepancy_detected(self) -> None:
        """A significant discrepancy should be flagged."""
        txns = [
            RawTransaction(date_str="01/05", description="DEPOSIT", amount_str="100.00", direction=Direction.CREDIT),
        ]
        # Expected: 5000 + 100 = 5100, actual: 5200 — discrepancy of -100
        parsed = _make_parsed(
            beginning=Decimal("5000.00"),
            ending=Decimal("5200.00"),
            transactions=txns,
        )
        result = reconcile_statement(parsed)
        assert result is not None
        assert result.is_reconciled is False
        assert result.discrepancy == Decimal("-100.00")

    def test_inferred_direction_from_sign(self) -> None:
        """Transactions without explicit direction use amount sign."""
        txns = [
            RawTransaction(date_str="01/05", description="DEPOSIT", amount_str="500.00"),
            RawTransaction(date_str="01/10", description="PURCHASE", amount_str="-200.00"),
        ]
        # beginning(1000) + 500 - 200 = 1300
        parsed = _make_parsed(
            beginning=Decimal("1000.00"),
            ending=Decimal("1300.00"),
            transactions=txns,
        )
        result = reconcile_statement(parsed)
        assert result is not None
        assert result.is_reconciled is True

    def test_skip_reconciliation_for_sweep_accounts(self) -> None:
        """Accounts with sweep-based balances are skipped."""
        txns = [RawTransaction(date_str="01/05", description="X", amount_str="100.00", direction=Direction.CREDIT)]
        parsed = _make_parsed(
            beginning=Decimal("1000.00"),
            ending=Decimal("9999.00"),
            transactions=txns,
            institution="wealthfront",
            account_name="cash_greendot",
        )
        assert reconcile_statement(parsed) is None

    def test_statement_period_in_result(self) -> None:
        txns = [RawTransaction(date_str="01/05", description="X", amount_str="100.00", direction=Direction.CREDIT)]
        parsed = _make_parsed(
            beginning=Decimal("1000.00"),
            ending=Decimal("1100.00"),
            transactions=txns,
        )
        result = reconcile_statement(parsed)
        assert result is not None
        assert "2025-01-01" in result.statement_period
        assert "2025-01-31" in result.statement_period
