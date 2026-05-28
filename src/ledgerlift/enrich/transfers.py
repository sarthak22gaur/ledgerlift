"""Transfer pair matching and double-count elimination.

Matches transfer transactions across accounts (e.g., CC payment appears as
debit on checking AND credit on CC) and assigns pair IDs for net filtering.
"""

from __future__ import annotations

import hashlib
import logging
from collections import defaultdict
from decimal import Decimal

from rapidfuzz import fuzz

from ledgerlift.models import CanonicalTransaction, Direction

logger = logging.getLogger(__name__)

CENT = Decimal("0.01")
MIN_MATCH_SCORE = 0.6


def match_transfer_pairs(
    transactions: list[CanonicalTransaction],
    date_tolerance_days: int = 5,
    amount_tolerance: Decimal = Decimal("0.01"),
) -> list[CanonicalTransaction]:
    """Match transfer pairs across accounts and assign transfer_pair_id.

    Algorithm:
    1. Filter candidates (is_transfer_candidate or is_internal_payment_candidate).
    2. Group by cent-quantized abs(amount), then compare compatible buckets.
    3. Score all valid candidate edges using date proximity, IPC agreement, and
       description similarity.
    4. Greedily commit highest-scoring edges above the match threshold.
    5. Generate transfer_pair_id from sorted transaction IDs.
    """
    # Separate candidates from non-candidates
    candidates: list[CanonicalTransaction] = []
    candidate_indices: dict[str, int] = {}  # txn_id -> index in transactions

    for i, txn in enumerate(transactions):
        if txn.is_transfer_candidate or txn.is_internal_payment_candidate:
            candidates.append(txn)
            candidate_indices[txn.transaction_id] = i

    if not candidates:
        return transactions

    amount_buckets: dict[Decimal, list[CanonicalTransaction]] = defaultdict(list)
    for txn in candidates:
        key = abs(txn.amount).quantize(CENT)
        amount_buckets[key].append(txn)

    matched_pairs: list[tuple[CanonicalTransaction, CanonicalTransaction, float]] = []
    already_matched: set[str] = set()
    edges: list[tuple[float, int, str, str, CanonicalTransaction, CanonicalTransaction]] = []

    amount_keys = sorted(amount_buckets)
    for i, amount_key in enumerate(amount_keys):
        for other_key in amount_keys[i:]:
            if other_key - amount_key > amount_tolerance:
                break

            left_bucket = amount_buckets[amount_key]
            right_bucket = amount_buckets[other_key]
            for left_idx, txn_a in enumerate(left_bucket):
                start_idx = left_idx + 1 if amount_key == other_key else 0
                for txn_b in right_bucket[start_idx:]:
                    edge = _score_candidate_pair(
                        txn_a,
                        txn_b,
                        date_tolerance_days=date_tolerance_days,
                        amount_tolerance=amount_tolerance,
                    )
                    if edge is None:
                        continue
                    score, date_diff = edge
                    pair_ids = sorted([txn_a.transaction_id, txn_b.transaction_id])
                    edges.append((score, date_diff, pair_ids[0], pair_ids[1], txn_a, txn_b))

    edges.sort(key=lambda e: (-e[0], e[1], e[2], e[3]))

    for score, _date_diff, _id_a, _id_b, txn_a, txn_b in edges:
        if score < MIN_MATCH_SCORE:
            break
        if txn_a.transaction_id in already_matched or txn_b.transaction_id in already_matched:
            continue
        confidence = _confidence_from_score(score)
        matched_pairs.append((txn_a, txn_b, confidence))
        already_matched.add(txn_a.transaction_id)
        already_matched.add(txn_b.transaction_id)

    if not matched_pairs:
        return transactions

    updates: dict[str, tuple[str, float]] = {}
    for txn_a, txn_b, confidence in matched_pairs:
        pair_id = _generate_pair_id(txn_a.transaction_id, txn_b.transaction_id)
        updates[txn_a.transaction_id] = (pair_id, confidence)
        updates[txn_b.transaction_id] = (pair_id, confidence)

    result: list[CanonicalTransaction] = []
    for txn in transactions:
        if txn.transaction_id in updates:
            pair_id, confidence = updates[txn.transaction_id]
            txn = txn.model_copy(update={
                "transfer_pair_id": pair_id,
                "transfer_match_confidence": confidence,
            })
        result.append(txn)

    logger.info("Matched %d transfer pairs across accounts", len(matched_pairs))
    return result


def _score_candidate_pair(
    txn_a: CanonicalTransaction,
    txn_b: CanonicalTransaction,
    *,
    date_tolerance_days: int,
    amount_tolerance: Decimal,
) -> tuple[float, int] | None:
    """Return match score/date_diff for a valid pair, or None if hard filters fail."""
    if (txn_a.institution, txn_a.account_name) == (txn_b.institution, txn_b.account_name):
        return None
    if txn_a.direction == txn_b.direction:
        return None
    if abs(abs(txn_a.amount) - abs(txn_b.amount)) > amount_tolerance:
        return None

    date_diff = abs((txn_a.transaction_date - txn_b.transaction_date).days)
    if date_diff > date_tolerance_days:
        return None

    description_similarity = (
        fuzz.token_set_ratio(txn_a.description_normalized, txn_b.description_normalized)
        / 100
    )
    ipc_mismatch = txn_a.is_internal_payment_candidate != txn_b.is_internal_payment_candidate
    score = 1.0 - (0.1 * date_diff) - (0.2 if ipc_mismatch else 0.0)
    score += 0.1 * description_similarity
    return score, date_diff


def _confidence_from_score(score: float) -> float:
    """Map edge score to existing coarse confidence buckets."""
    if score >= 0.95:
        return 1.0
    if score >= 0.85:
        return 0.9
    if score >= 0.75:
        return 0.8
    return 0.7


def _generate_pair_id(txn_id_1: str, txn_id_2: str) -> str:
    sorted_ids = sorted([txn_id_1, txn_id_2])
    return hashlib.sha256(f"{sorted_ids[0]}:{sorted_ids[1]}".encode()).hexdigest()[:12]


def filter_net_transactions(
    transactions: list[CanonicalTransaction],
) -> list[CanonicalTransaction]:
    """Exclude both sides of matched transfer pairs; unpaired transactions pass through."""
    pairs: dict[str, list[CanonicalTransaction]] = defaultdict(list)
    for txn in transactions:
        if txn.transfer_pair_id:
            pairs[txn.transfer_pair_id].append(txn)

    exclude_ids: set[str] = set()
    for _pair_id, pair_txns in pairs.items():
        if len(pair_txns) != 2:
            continue
        for txn in pair_txns:
            exclude_ids.add(txn.transaction_id)

    result = [txn for txn in transactions if txn.transaction_id not in exclude_ids]

    excluded = len(transactions) - len(result)
    if excluded > 0:
        logger.info(
            "Net filter: excluded %d transactions from %d matched transfer pairs",
            excluded,
            excluded // 2,
        )

    return result
