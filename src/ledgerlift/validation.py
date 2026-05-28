"""Validation checks for parsed statements."""

from __future__ import annotations

import logging
from decimal import Decimal

from ledgerlift.models import Direction, ParsedStatement

logger = logging.getLogger(__name__)


def validate_parsed_statement(parsed: ParsedStatement) -> list[str]:
    """Run validation checks on a parsed statement. Returns a list of warnings."""
    warnings: list[str] = []

    # Check statement period detected
    if parsed.metadata.statement_start_date is None:
        warnings.append("Statement start date not detected")
    if parsed.metadata.statement_end_date is None:
        warnings.append("Statement end date not detected")

    # Check transactions exist
    if not parsed.raw_transactions:
        warnings.append("No transactions extracted")
        return warnings

    # Check all transactions have required fields
    for i, txn in enumerate(parsed.raw_transactions):
        if not txn.date_str:
            warnings.append(f"Transaction {i}: missing date")
        if not txn.description:
            warnings.append(f"Transaction {i}: missing description")
        if not txn.amount_str:
            warnings.append(f"Transaction {i}: missing amount")

    # Balance reconciliation
    from ledgerlift.reconciliation import reconcile_statement

    recon = reconcile_statement(parsed)
    if recon is not None and not recon.is_reconciled:
        warnings.append(
            f"Balance reconciliation failed: beginning={recon.beginning_balance}, "
            f"expected_ending={recon.expected_ending}, actual_ending={recon.ending_balance}, "
            f"discrepancy={recon.discrepancy}"
        )

    # Try to validate totals against statement summary
    if parsed.metadata.total_credits is not None:
        credit_sum = _sum_by_direction(parsed, Direction.CREDIT)
        if credit_sum is not None and credit_sum != parsed.metadata.total_credits:
            warnings.append(
                f"Credit total mismatch: extracted={credit_sum}, "
                f"statement={parsed.metadata.total_credits}"
            )

    if parsed.metadata.total_debits is not None:
        debit_sum = _sum_by_direction(parsed, Direction.DEBIT)
        if debit_sum is not None and debit_sum != parsed.metadata.total_debits:
            warnings.append(
                f"Debit total mismatch: extracted={debit_sum}, "
                f"statement={parsed.metadata.total_debits}"
            )

    return warnings


def _sum_by_direction(parsed: ParsedStatement, direction: Direction) -> Decimal | None:
    """Sum transaction amounts for a given direction."""
    from ledgerlift.utils.money import parse_amount

    total = Decimal("0")
    for txn in parsed.raw_transactions:
        if txn.direction == direction:
            amount = parse_amount(txn.amount_str)
            if amount is None:
                return None  # Can't validate if amounts don't parse
            total += abs(amount)
    return total
