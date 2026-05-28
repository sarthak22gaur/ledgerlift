"""Tests for export and deduplication."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

import pytest

from ledgerlift.exporters import deduplicate_transactions, sort_transactions
from ledgerlift.models import CanonicalTransaction, Direction, TransactionType


def _make_txn(
    txn_id: str = "t1",
    txn_date: date = date(2023, 1, 15),
    amount: Decimal = Decimal("-50.00"),
    description: str = "TEST PURCHASE",
    source_hash: str = "hash1",
) -> CanonicalTransaction:
    return CanonicalTransaction(
        transaction_id=txn_id,
        source_file_hash=source_hash,
        source_file_path="/test/path.pdf",
        institution="chase",
        account_name="checking",
        account_type="checking",
        transaction_date=txn_date,
        description_raw=description,
        description_normalized=description,
        amount=amount,
        direction=Direction.DEBIT,
        transaction_type=TransactionType.PURCHASE,
        parser_name="chase_checking_pdf",
        parser_version="0.1.0",
        import_timestamp=datetime(2023, 6, 1, 12, 0, 0),
    )


class TestDeduplication:
    def test_no_duplicates(self) -> None:
        txns = [
            _make_txn(txn_id="t1", txn_date=date(2023, 1, 15)),
            _make_txn(txn_id="t2", txn_date=date(2023, 1, 16)),
        ]
        result = deduplicate_transactions(txns)
        assert len(result) == 2

    def test_exact_duplicates_removed(self) -> None:
        txn = _make_txn()
        result = deduplicate_transactions([txn, txn])
        assert len(result) == 1

    def test_different_amounts_not_deduped(self) -> None:
        t1 = _make_txn(txn_id="t1", amount=Decimal("-50.00"))
        t2 = _make_txn(txn_id="t2", amount=Decimal("-75.00"))
        result = deduplicate_transactions([t1, t2])
        assert len(result) == 2


class TestSorting:
    def test_sorts_by_date(self) -> None:
        txns = [
            _make_txn(txn_id="t2", txn_date=date(2023, 1, 20)),
            _make_txn(txn_id="t1", txn_date=date(2023, 1, 10)),
        ]
        result = sort_transactions(txns)
        assert result[0].transaction_date == date(2023, 1, 10)
        assert result[1].transaction_date == date(2023, 1, 20)
