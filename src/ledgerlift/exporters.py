"""Export canonical transactions to CSV and JSON."""

from __future__ import annotations

import csv
import json
import logging
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from ledgerlift.config import EXPORTS_DIR
from ledgerlift.models import CanonicalTransaction

logger = logging.getLogger(__name__)

CSV_FIELDS = [
    "transaction_id",
    "institution",
    "account_name",
    "account_type",
    "transaction_date",
    "posted_date",
    "description_raw",
    "description_normalized",
    "merchant_normalized",
    "merchant_confidence",
    "merchant_rule_id",
    "amount",
    "currency",
    "direction",
    "transaction_type",
    "category_raw",
    "category_normalized",
    "category_confidence",
    "category_rule_id",
    "subcategory_normalized",
    "is_transfer_candidate",
    "is_internal_payment_candidate",
    "transfer_pair_id",
    "transfer_match_confidence",
    "reference_number",
    "source_file_hash",
    "statement_start_date",
    "statement_end_date",
    "parser_name",
    "parser_version",
    "import_timestamp",
    "enriched_at",
]


def deduplicate_transactions(
    transactions: list[CanonicalTransaction],
) -> list[CanonicalTransaction]:
    """Deduplicate transactions using a conservative key.

    Dedup key: transaction_id

    Transaction IDs include source-file and in-statement identity. This only
    removes exact parser reruns of the same canonical transaction.
    """
    seen: set[str] = set()
    unique: list[CanonicalTransaction] = []

    for txn in transactions:
        key = txn.transaction_id
        if key not in seen:
            seen.add(key)
            unique.append(txn)
        else:
            logger.debug("Deduplicating transaction: %s", key)

    deduped = len(transactions) - len(unique)
    if deduped > 0:
        logger.info("Deduplicated %d transactions", deduped)

    return unique


def sort_transactions(transactions: list[CanonicalTransaction]) -> list[CanonicalTransaction]:
    """Sort transactions deterministically for stable output."""
    return sorted(
        transactions,
        key=lambda t: (t.transaction_date, t.institution, t.account_name, t.amount, t.transaction_id),
    )


class JsonEncoder(json.JSONEncoder):
    """Custom JSON encoder for our data types."""

    def default(self, o: object) -> object:
        if isinstance(o, Decimal):
            return str(o)
        if isinstance(o, (date, datetime)):
            return o.isoformat()
        return super().default(o)


def export_csv(transactions: list[CanonicalTransaction], output_path: Path | None = None) -> Path:
    """Export transactions to CSV."""
    output_path = output_path or EXPORTS_DIR / "canonical_transactions.csv"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for txn in transactions:
            row = {}
            for field in CSV_FIELDS:
                value = getattr(txn, field)
                if isinstance(value, (date, datetime)):
                    row[field] = value.isoformat()
                elif isinstance(value, Decimal):
                    row[field] = str(value)
                elif hasattr(value, "value"):  # Enum
                    row[field] = value.value
                elif value is None:
                    row[field] = ""
                else:
                    row[field] = str(value)
            writer.writerow(row)

    logger.info("Exported %d transactions to %s", len(transactions), output_path)
    return output_path


def export_json(transactions: list[CanonicalTransaction], output_path: Path | None = None) -> Path:
    """Export transactions to JSON."""
    output_path = output_path or EXPORTS_DIR / "canonical_transactions.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    data = []
    for txn in transactions:
        d = txn.model_dump()
        # Convert enums to values
        for key, val in d.items():
            if hasattr(val, "value"):
                d[key] = val.value
        data.append(d)

    with open(output_path, "w") as f:
        json.dump(data, f, indent=2, cls=JsonEncoder)

    logger.info("Exported %d transactions to %s", len(transactions), output_path)
    return output_path
