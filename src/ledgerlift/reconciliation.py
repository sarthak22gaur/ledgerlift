"""Statement balance reconciliation."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal

from ledgerlift.models import Direction, ParsedStatement

logger = logging.getLogger(__name__)

TOLERANCE = Decimal("0.02")

_CREDIT_CARD_TYPES = frozenset({"credit", "credit_card"})

# Balances include internal sweeps we intentionally exclude from parsed transactions.
_SKIP_RECONCILIATION = frozenset({
    ("wealthfront", "cash_greendot"),
    ("sofi", "bank"),  # SoFi PDFs mix checking+savings; metadata has checking balances only
})


@dataclass
class ReconciliationResult:
    """Result of reconciling a single statement's balance."""

    institution: str
    account_name: str
    source_file: str
    statement_period: str
    beginning_balance: Decimal
    ending_balance: Decimal
    expected_ending: Decimal
    discrepancy: Decimal
    transaction_count: int
    is_reconciled: bool


def reconcile_statement(parsed: ParsedStatement) -> ReconciliationResult | None:
    """Reconcile a parsed statement's balance against its transactions.

    Formula:
    - Checking/savings/bank/cash: beginning + credits - debits = ending
    - Credit cards: beginning + debits - credits = ending
      (charges increase balance, payments decrease it)

    Returns None if required balance data is missing.
    """
    from ledgerlift.utils.money import parse_amount

    meta = parsed.metadata

    # Skip accounts where balances include sweeps we intentionally exclude
    if (meta.institution, meta.account_name) in _SKIP_RECONCILIATION:
        return None

    if meta.beginning_balance is None or meta.ending_balance is None:
        return None

    if not parsed.raw_transactions:
        return None

    beginning = meta.beginning_balance
    ending = meta.ending_balance
    is_credit_card = meta.account_type in _CREDIT_CARD_TYPES

    credit_sum = Decimal("0")
    debit_sum = Decimal("0")

    for txn in parsed.raw_transactions:
        amount = parse_amount(txn.amount_str)
        if amount is None:
            logger.warning("Cannot parse amount '%s', skipping reconciliation", txn.amount_str)
            return None

        abs_amount = abs(amount)

        if txn.direction == Direction.CREDIT:
            credit_sum += abs_amount
        elif txn.direction == Direction.DEBIT:
            debit_sum += abs_amount
        else:
            if amount >= 0:
                credit_sum += abs_amount
            else:
                debit_sum += abs_amount

    if is_credit_card:
        # Credit cards: charges (debits) increase balance, payments (credits) decrease
        expected = beginning + debit_sum - credit_sum
    else:
        # Checking/savings: deposits (credits) increase, withdrawals (debits) decrease
        expected = beginning + credit_sum - debit_sum

    discrepancy = expected - ending

    # Build period string
    start = meta.statement_start_date
    end = meta.statement_end_date
    if start and end:
        period = f"{start.isoformat()} to {end.isoformat()}"
    else:
        period = "unknown"

    return ReconciliationResult(
        institution=meta.institution,
        account_name=meta.account_name,
        source_file=parsed.source_file_path,
        statement_period=period,
        beginning_balance=beginning,
        ending_balance=ending,
        expected_ending=expected,
        discrepancy=discrepancy,
        transaction_count=len(parsed.raw_transactions),
        is_reconciled=abs(discrepancy) <= TOLERANCE,
    )
