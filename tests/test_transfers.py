"""Tests for transfer pair matching and net filtering."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

import pytest

from ledgerlift.enrich.transfers import filter_net_transactions, match_transfer_pairs
from ledgerlift.models import CanonicalTransaction, Direction, TransactionType


def _make_txn(
    txn_id: str,
    institution: str,
    account_name: str,
    amount: Decimal,
    direction: Direction,
    txn_date: date,
    is_transfer: bool = False,
    is_internal_payment: bool = False,
    description: str = "TEST",
) -> CanonicalTransaction:
    return CanonicalTransaction(
        transaction_id=txn_id,
        source_file_hash="hash",
        source_file_path="/test.pdf",
        institution=institution,
        account_name=account_name,
        account_type=account_name,
        transaction_date=txn_date,
        description_raw=description,
        description_normalized=description,
        amount=amount,
        direction=direction,
        transaction_type=TransactionType.TRANSFER if is_transfer else TransactionType.PAYMENT,
        is_transfer_candidate=is_transfer,
        is_internal_payment_candidate=is_internal_payment,
        parser_name="test",
        parser_version="0.1.0",
        import_timestamp=datetime(2025, 6, 1),
    )


class TestMatchTransferPairs:
    def test_exact_match_across_accounts(self) -> None:
        """Exact amount + same date across different accounts → paired."""
        txns = [
            _make_txn("a1", "chase", "checking", Decimal("-700.00"), Direction.DEBIT, date(2025, 6, 22), is_transfer=True),
            _make_txn("b1", "wealthfront", "cash", Decimal("700.00"), Direction.CREDIT, date(2025, 6, 22), is_transfer=True),
        ]
        result = match_transfer_pairs(txns)
        paired = [t for t in result if t.transfer_pair_id is not None]
        assert len(paired) == 2
        assert paired[0].transfer_pair_id == paired[1].transfer_pair_id
        assert paired[0].transfer_match_confidence == 1.0

    def test_same_account_not_matched(self) -> None:
        """Transactions within the same account should NOT be paired."""
        txns = [
            _make_txn("a1", "chase", "checking", Decimal("-500.00"), Direction.DEBIT, date(2025, 6, 22), is_transfer=True),
            _make_txn("a2", "chase", "checking", Decimal("500.00"), Direction.CREDIT, date(2025, 6, 22), is_transfer=True),
        ]
        result = match_transfer_pairs(txns)
        paired = [t for t in result if t.transfer_pair_id is not None]
        assert len(paired) == 0

    def test_same_direction_not_matched(self) -> None:
        """Transactions with same direction should NOT be paired."""
        txns = [
            _make_txn("a1", "chase", "checking", Decimal("-500.00"), Direction.DEBIT, date(2025, 6, 22), is_transfer=True),
            _make_txn("b1", "wealthfront", "cash", Decimal("-500.00"), Direction.DEBIT, date(2025, 6, 22), is_transfer=True),
        ]
        result = match_transfer_pairs(txns)
        paired = [t for t in result if t.transfer_pair_id is not None]
        assert len(paired) == 0

    def test_date_tolerance_1_day(self) -> None:
        """1-day gap should match with 0.9 confidence."""
        txns = [
            _make_txn(
                "a1",
                "chase",
                "checking",
                Decimal("-700.00"),
                Direction.DEBIT,
                date(2025, 6, 22),
                is_transfer=True,
                description="alpha",
            ),
            _make_txn(
                "b1",
                "wealthfront",
                "cash",
                Decimal("700.00"),
                Direction.CREDIT,
                date(2025, 6, 23),
                is_transfer=True,
                description="omega",
            ),
        ]
        result = match_transfer_pairs(txns)
        paired = [t for t in result if t.transfer_pair_id is not None]
        assert len(paired) == 2
        assert paired[0].transfer_match_confidence == 0.9

    def test_decimal_exponents_share_cent_bucket(self) -> None:
        """Same cent amount with different Decimal exponents should match."""
        txns = [
            _make_txn("a1", "chase", "checking", Decimal("-100.0"), Direction.DEBIT, date(2025, 6, 22), is_transfer=True),
            _make_txn("b1", "wealthfront", "cash", Decimal("100.00"), Direction.CREDIT, date(2025, 6, 22), is_transfer=True),
        ]
        result = match_transfer_pairs(txns)
        paired = [t for t in result if t.transfer_pair_id is not None]
        assert len(paired) == 2

    def test_amount_tolerance_matches_adjacent_cent_buckets(self) -> None:
        """A one-cent amount difference should match within the default tolerance."""
        txns = [
            _make_txn("a1", "chase", "checking", Decimal("-100.00"), Direction.DEBIT, date(2025, 6, 22), is_transfer=True),
            _make_txn("b1", "wealthfront", "cash", Decimal("100.01"), Direction.CREDIT, date(2025, 6, 22), is_transfer=True),
        ]
        result = match_transfer_pairs(txns)
        paired = [t for t in result if t.transfer_pair_id is not None]
        assert len(paired) == 2

    def test_date_tolerance_exceeded(self) -> None:
        """6-day gap should NOT match (default tolerance is 5)."""
        txns = [
            _make_txn("a1", "chase", "checking", Decimal("-700.00"), Direction.DEBIT, date(2025, 6, 22), is_transfer=True),
            _make_txn("b1", "wealthfront", "cash", Decimal("700.00"), Direction.CREDIT, date(2025, 6, 28), is_transfer=True),
        ]
        result = match_transfer_pairs(txns)
        paired = [t for t in result if t.transfer_pair_id is not None]
        assert len(paired) == 0

    def test_non_candidates_not_matched(self) -> None:
        """Regular transactions (not transfer/payment candidates) should not match."""
        txns = [
            _make_txn("a1", "chase", "checking", Decimal("-50.00"), Direction.DEBIT, date(2025, 6, 22)),
            _make_txn("b1", "amex", "credit", Decimal("50.00"), Direction.CREDIT, date(2025, 6, 22)),
        ]
        result = match_transfer_pairs(txns)
        paired = [t for t in result if t.transfer_pair_id is not None]
        assert len(paired) == 0

    def test_multiple_transfers_matched_by_nearest_date(self) -> None:
        """Multiple transfers at same amount should match by nearest date."""
        txns = [
            _make_txn("a1", "chase", "checking", Decimal("-500.00"), Direction.DEBIT, date(2025, 6, 10), is_transfer=True),
            _make_txn("a2", "chase", "checking", Decimal("-500.00"), Direction.DEBIT, date(2025, 6, 20), is_transfer=True),
            _make_txn("b1", "wealthfront", "cash", Decimal("500.00"), Direction.CREDIT, date(2025, 6, 10), is_transfer=True),
            _make_txn("b2", "wealthfront", "cash", Decimal("500.00"), Direction.CREDIT, date(2025, 6, 21), is_transfer=True),
        ]
        result = match_transfer_pairs(txns)
        paired = [t for t in result if t.transfer_pair_id is not None]
        assert len(paired) == 4  # Both pairs should match

        # a1 should pair with b1 (same date), a2 should pair with b2 (1 day gap)
        pair_ids = {t.transaction_id: t.transfer_pair_id for t in result}
        assert pair_ids["a1"] == pair_ids["b1"]
        assert pair_ids["a2"] == pair_ids["b2"]
        assert pair_ids["a1"] != pair_ids["a2"]

    def test_description_similarity_wins_same_date_collision(self) -> None:
        """Same-date amount collisions should prefer description evidence."""
        txns = [
            _make_txn(
                "debit",
                "chase",
                "checking",
                Decimal("-500.00"),
                Direction.DEBIT,
                date(2025, 6, 22),
                is_transfer=True,
                description="capital one credit card payment",
            ),
            _make_txn(
                "wrong",
                "wealthfront",
                "cash",
                Decimal("500.00"),
                Direction.CREDIT,
                date(2025, 6, 22),
                is_transfer=True,
                description="transfer from savings",
            ),
            _make_txn(
                "correct",
                "capitalone",
                "credit",
                Decimal("500.00"),
                Direction.CREDIT,
                date(2025, 6, 22),
                is_transfer=True,
                description="capital one payment thank you",
            ),
        ]
        result = match_transfer_pairs(txns)
        pair_ids = {t.transaction_id: t.transfer_pair_id for t in result}
        assert pair_ids["debit"] == pair_ids["correct"]
        assert pair_ids["wrong"] is None

    def test_ipc_mismatch_penalty_breaks_tie(self) -> None:
        """Prefer IPC-aligned candidates even when another edge has better text."""
        txns = [
            _make_txn(
                "debit",
                "chase",
                "checking",
                Decimal("-500.00"),
                Direction.DEBIT,
                date(2025, 6, 22),
                is_internal_payment=True,
                description="capital one autopay",
            ),
            _make_txn(
                "mismatch",
                "wealthfront",
                "cash",
                Decimal("500.00"),
                Direction.CREDIT,
                date(2025, 6, 22),
                is_transfer=True,
                description="capital one autopay",
            ),
            _make_txn(
                "aligned",
                "capitalone",
                "credit",
                Decimal("500.00"),
                Direction.CREDIT,
                date(2025, 6, 22),
                is_internal_payment=True,
                description="zzz",
            ),
        ]
        result = match_transfer_pairs(txns)
        pair_ids = {t.transaction_id: t.transfer_pair_id for t in result}
        assert pair_ids["debit"] == pair_ids["aligned"]
        assert pair_ids["mismatch"] is None

    def test_tie_breaks_by_transaction_id(self) -> None:
        """Identical scores should commit the lexicographically first pair."""
        txns = [
            _make_txn("debit", "chase", "checking", Decimal("-500.00"), Direction.DEBIT, date(2025, 6, 22), is_transfer=True),
            _make_txn("credit-b", "wealthfront", "cash", Decimal("500.00"), Direction.CREDIT, date(2025, 6, 22), is_transfer=True),
            _make_txn("credit-a", "capitalone", "credit", Decimal("500.00"), Direction.CREDIT, date(2025, 6, 22), is_transfer=True),
        ]
        result = match_transfer_pairs(txns)
        pair_ids = {t.transaction_id: t.transfer_pair_id for t in result}
        assert pair_ids["debit"] == pair_ids["credit-a"]
        assert pair_ids["credit-b"] is None

    def test_preserves_non_candidate_transactions(self) -> None:
        """Non-candidate transactions should be returned unchanged."""
        txns = [
            _make_txn("a1", "chase", "checking", Decimal("-50.00"), Direction.DEBIT, date(2025, 6, 22)),
            _make_txn("a2", "chase", "checking", Decimal("-700.00"), Direction.DEBIT, date(2025, 6, 22), is_transfer=True),
            _make_txn("b1", "wealthfront", "cash", Decimal("700.00"), Direction.CREDIT, date(2025, 6, 22), is_transfer=True),
        ]
        result = match_transfer_pairs(txns)
        assert len(result) == 3
        assert result[0].transfer_pair_id is None  # Non-candidate unchanged


class TestFilterNetTransactions:
    def test_cc_payment_excludes_both_sides(self) -> None:
        """CC payments should exclude both sides."""
        txns = [
            _make_txn("a1", "chase", "checking", Decimal("-500.00"), Direction.DEBIT, date(2025, 6, 22), is_internal_payment=True),
            _make_txn("b1", "chase", "credit", Decimal("500.00"), Direction.CREDIT, date(2025, 6, 22), is_internal_payment=True),
            _make_txn("c1", "chase", "credit", Decimal("-50.00"), Direction.DEBIT, date(2025, 6, 15)),  # Regular purchase
        ]
        # Simulate pairing
        pair_id = "test_pair_1"
        txns[0] = txns[0].model_copy(update={"transfer_pair_id": pair_id, "transfer_match_confidence": 1.0})
        txns[1] = txns[1].model_copy(update={"transfer_pair_id": pair_id, "transfer_match_confidence": 1.0})

        result = filter_net_transactions(txns)
        assert len(result) == 1  # Only the regular purchase remains
        assert result[0].transaction_id == "c1"

    def test_regular_transfer_excludes_both_sides(self) -> None:
        """Regular transfers should exclude both sides."""
        txns = [
            _make_txn("a1", "chase", "checking", Decimal("-700.00"), Direction.DEBIT, date(2025, 6, 22), is_transfer=True),
            _make_txn("b1", "wealthfront", "cash", Decimal("700.00"), Direction.CREDIT, date(2025, 6, 22), is_transfer=True),
        ]
        pair_id = "test_pair_2"
        txns[0] = txns[0].model_copy(update={"transfer_pair_id": pair_id, "transfer_match_confidence": 1.0})
        txns[1] = txns[1].model_copy(update={"transfer_pair_id": pair_id, "transfer_match_confidence": 1.0})

        result = filter_net_transactions(txns)
        assert len(result) == 0

    def test_unpaired_transactions_unchanged(self) -> None:
        """Transactions without pair IDs should pass through unchanged."""
        txns = [
            _make_txn("a1", "chase", "checking", Decimal("-50.00"), Direction.DEBIT, date(2025, 6, 22)),
            _make_txn("a2", "chase", "checking", Decimal("-100.00"), Direction.DEBIT, date(2025, 6, 23)),
        ]
        result = filter_net_transactions(txns)
        assert len(result) == 2
