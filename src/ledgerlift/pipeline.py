"""Core pipeline orchestration: scan, parse, enrich, export."""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from ledgerlift.config import RAW_DIR, ensure_dirs
from ledgerlift.exporters import (
    deduplicate_transactions,
    export_csv,
    export_json,
    sort_transactions,
)
from ledgerlift.hashing import hash_file
from ledgerlift.models import CanonicalTransaction, ParseStatus
from ledgerlift.normalize import normalize_statement
from ledgerlift.parsers import get_parser
from ledgerlift.parsers.base import ParseError
from ledgerlift.validation import validate_parsed_statement
from ledgerlift import store as _store

logger = logging.getLogger(__name__)


SUPPORTED_EXTENSIONS = (".pdf", ".csv")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _txn_to_row(txn: CanonicalTransaction, file_hash: str, statement_id: str) -> dict:
    return {
        "transaction_id": txn.transaction_id,
        "source_file_hash": file_hash,
        "statement_id": statement_id,
        "institution": txn.institution,
        "account_name": txn.account_name,
        "account_type": txn.account_type,
        "statement_start_date": txn.statement_start_date.isoformat() if txn.statement_start_date else None,
        "statement_end_date": txn.statement_end_date.isoformat() if txn.statement_end_date else None,
        "transaction_date": txn.transaction_date.isoformat(),
        "posted_date": txn.posted_date.isoformat() if txn.posted_date else None,
        "description_raw": txn.description_raw,
        "description_normalized": txn.description_normalized,
        "amount": float(txn.amount),
        "currency": txn.currency,
        "direction": txn.direction.value,
        "transaction_type": txn.transaction_type.value,
        "category_raw": txn.category_raw,
        "category_normalized": txn.category_normalized,
        "subcategory_normalized": txn.subcategory_normalized,
        "merchant_normalized": txn.merchant_normalized,
        "merchant_confidence": txn.merchant_confidence,
        "merchant_rule_id": txn.merchant_rule_id,
        "category_confidence": txn.category_confidence,
        "category_rule_id": txn.category_rule_id,
        "reference_number": txn.reference_number,
        "is_transfer_candidate": 1 if txn.is_transfer_candidate else 0,
        "is_internal_payment_candidate": 1 if txn.is_internal_payment_candidate else 0,
        "transfer_pair_id": txn.transfer_pair_id,
        "transfer_match_confidence": txn.transfer_match_confidence,
        "parser_name": txn.parser_name,
        "parser_version": txn.parser_version,
        "import_timestamp": txn.import_timestamp.isoformat(),
        "enriched_at": txn.enriched_at.isoformat() if txn.enriched_at else None,
    }


def _row_to_txn(row: sqlite3.Row) -> CanonicalTransaction:
    from datetime import date
    from ledgerlift.models import Direction, TransactionType

    def _parse_date(val: str | None):
        return date.fromisoformat(val) if val else None

    def _parse_dt(val: str | None):
        return datetime.fromisoformat(val) if val else None

    return CanonicalTransaction(
        transaction_id=row["transaction_id"],
        source_file_hash=row["source_file_hash"],
        source_file_path=row["source_file_hash"],
        institution=row["institution"],
        account_name=row["account_name"],
        account_type=row["account_type"],
        statement_start_date=_parse_date(row["statement_start_date"]),
        statement_end_date=_parse_date(row["statement_end_date"]),
        transaction_date=date.fromisoformat(row["transaction_date"]),
        posted_date=_parse_date(row["posted_date"]),
        description_raw=row["description_raw"],
        description_normalized=row["description_normalized"],
        amount=Decimal(str(row["amount"])),
        currency=row["currency"],
        direction=Direction(row["direction"]),
        transaction_type=TransactionType(row["transaction_type"]),
        category_raw=row["category_raw"],
        category_normalized=row["category_normalized"],
        subcategory_normalized=row["subcategory_normalized"],
        merchant_normalized=row["merchant_normalized"],
        merchant_confidence=row["merchant_confidence"],
        merchant_rule_id=row["merchant_rule_id"],
        category_confidence=row["category_confidence"],
        category_rule_id=row["category_rule_id"],
        reference_number=row["reference_number"],
        is_transfer_candidate=bool(row["is_transfer_candidate"]),
        is_internal_payment_candidate=bool(row["is_internal_payment_candidate"]),
        transfer_pair_id=row["transfer_pair_id"],
        transfer_match_confidence=row["transfer_match_confidence"],
        parser_name=row["parser_name"],
        parser_version=row["parser_version"],
        import_timestamp=_parse_dt(row["import_timestamp"]) or datetime.now(timezone.utc),
        enriched_at=_parse_dt(row["enriched_at"]),
    )


def discover_source_files(
    institution: str | None = None,
    account: str | None = None,
    year: int | None = None,
) -> list[tuple[Path, str, str, int | None]]:
    """Discover source files (PDFs and CSVs) under data/raw/.

    Returns list of (path, institution, account_name, year).
    """
    files: list[tuple[Path, str, str, int | None]] = []

    raw_dir = RAW_DIR
    if institution:
        raw_dir = raw_dir / institution
        if account:
            raw_dir = raw_dir / account

    if not raw_dir.exists():
        logger.warning("Raw directory does not exist: %s", raw_dir)
        return files

    all_files = sorted(
        f for f in raw_dir.rglob("*") if f.suffix.lower() in SUPPORTED_EXTENSIONS
    )
    for file_path in all_files:
        try:
            rel = file_path.relative_to(RAW_DIR)
            parts = rel.parts
            if len(parts) < 3:
                logger.warning("Unexpected path structure: %s", file_path)
                continue
            inst = parts[0]
            acct = parts[1]
            yr = None
            if len(parts) >= 4:
                try:
                    yr = int(parts[2])
                except ValueError:
                    pass
        except ValueError:
            logger.warning("File not under raw dir: %s", file_path)
            continue

        if institution and inst != institution:
            continue
        if account and acct != account:
            continue
        if year and yr != year:
            continue

        files.append((file_path, inst, acct, yr))

    return files


def scan(
    conn: sqlite3.Connection,
    institution: str | None = None,
    account: str | None = None,
    year: int | None = None,
) -> dict[str, int]:
    """Scan for source files and register them in the store.

    Returns counts of new, existing, total files.
    """
    ensure_dirs()
    files = discover_source_files(institution, account, year)
    counts = {"new": 0, "existing": 0, "total": len(files)}

    for file_path, inst, acct, yr in files:
        file_hash = hash_file(file_path)
        relative_path = str(file_path.relative_to(RAW_DIR))

        existing = _store.get_source_file(conn, file_hash)
        if existing is None:
            _store.upsert_source_file(conn, file_hash, relative_path, inst, acct)
            counts["new"] += 1
        else:
            counts["existing"] += 1

    logger.info(
        "Scan complete: %d total, %d new, %d existing",
        counts["total"],
        counts["new"],
        counts["existing"],
    )
    return counts


def parse_file(
    conn: sqlite3.Connection,
    file_path: Path,
    institution: str,
    account: str,
    force: bool = False,
) -> bool:
    """Parse a single source file. Returns True if parsing succeeded."""
    file_hash = hash_file(file_path)
    relative_path = str(file_path.relative_to(RAW_DIR))

    _store.upsert_source_file(conn, file_hash, relative_path, institution, account)

    existing = _store.get_source_file(conn, file_hash)
    if not force and existing and existing["parse_status"] == ParseStatus.PARSED.value:
        logger.info("Skipping already parsed file: %s", file_path.name)
        return True

    try:
        parser = get_parser(institution, account)
    except ValueError as e:
        logger.error("No parser available: %s", e)
        _store.mark_source_file_failed(conn, file_hash, str(e), _now_iso())
        return False

    try:
        parsed = parser.parse(file_path, file_hash)
    except ParseError as e:
        logger.error("Parse error for %s: %s", file_path.name, e)
        _store.mark_source_file_failed(conn, file_hash, str(e), _now_iso())
        return False
    except Exception as e:
        logger.error("Unexpected error parsing %s: %s", file_path.name, e)
        _store.mark_source_file_failed(conn, file_hash, f"Unexpected: {e}", _now_iso())
        return False

    validation_warnings = validate_parsed_statement(parsed)
    parsed.warnings.extend(validation_warnings)
    for w in validation_warnings:
        logger.warning("Validation: %s — %s", file_path.name, w)

    normalized = normalize_statement(parsed)

    import hashlib
    stmt_id = hashlib.sha256(f"{file_hash}:{institution}:{account}".encode()).hexdigest()[:16]

    meta = parsed.metadata
    stmt_row = {
        "id": stmt_id,
        "source_file_hash": file_hash,
        "institution": institution,
        "account_name": account,
        "account_type": meta.account_type,
        "statement_start_date": meta.statement_start_date.isoformat() if meta.statement_start_date else None,
        "statement_end_date": meta.statement_end_date.isoformat() if meta.statement_end_date else None,
        "beginning_balance": float(meta.beginning_balance) if meta.beginning_balance is not None else None,
        "ending_balance": float(meta.ending_balance) if meta.ending_balance is not None else None,
        "total_credits": float(meta.total_credits) if meta.total_credits is not None else None,
        "total_debits": float(meta.total_debits) if meta.total_debits is not None else None,
        "parser_name": parsed.parser_name,
        "parser_version": parsed.parser_version,
    }
    _store.upsert_statement(conn, stmt_row)

    from ledgerlift.utils.money import parse_amount as _parse_amount  # noqa: PLC0415
    raw_rows = []
    for i, rt in enumerate(parsed.raw_transactions):
        parsed_amt = _parse_amount(rt.amount_str) if rt.amount_str else None
        raw_rows.append({
            "statement_id": stmt_id,
            "line_number": i,
            "raw_text": rt.description,
            "posted_date": None,
            "transaction_date": rt.date_str,
            "description": rt.description,
            "amount": float(parsed_amt) if parsed_amt is not None else None,
            "direction": rt.direction.value if rt.direction else None,
            "category_raw": rt.section,
            "reference_number": rt.reference_number,
        })
    _store.insert_raw_transactions(conn, raw_rows)

    _store.delete_transactions_for_file(conn, file_hash)
    txn_rows = [_txn_to_row(txn, file_hash, stmt_id) for txn in normalized]
    _store.upsert_transactions(conn, txn_rows)

    _store.mark_source_file_parsed(conn, file_hash, _now_iso())

    logger.info(
        "Successfully parsed %s: %d transactions", file_path.name, len(normalized)
    )
    return True


def parse_all(
    conn: sqlite3.Connection,
    institution: str | None = None,
    account: str | None = None,
    year: int | None = None,
    force: bool = False,
) -> dict[str, int]:
    """Parse all source files that need parsing."""
    ensure_dirs()
    files = discover_source_files(institution, account, year)
    counts = {"parsed": 0, "skipped": 0, "failed": 0, "total": len(files)}

    for file_path, inst, acct, yr in files:
        file_hash = hash_file(file_path)
        existing = _store.get_source_file(conn, file_hash)

        if not force and existing and existing["parse_status"] == ParseStatus.PARSED.value:
            counts["skipped"] += 1
            continue

        success = parse_file(conn, file_path, inst, acct, force=force)
        if success:
            counts["parsed"] += 1
        else:
            counts["failed"] += 1

    logger.info(
        "Parse complete: %d parsed, %d skipped, %d failed out of %d total",
        counts["parsed"], counts["skipped"], counts["failed"], counts["total"],
    )
    return counts


def enrich_all(
    conn: sqlite3.Connection,
    institution: str | None = None,
    account: str | None = None,
    force: bool = False,
    enable_fuzzy: bool = True,
) -> dict[str, int]:
    """Enrich all parsed transactions with merchant and category rules."""
    from ledgerlift.enrich.engine import RuleEngine

    ensure_dirs()
    engine = RuleEngine.from_db(conn, enable_fuzzy=enable_fuzzy)

    parsed_files = _store.list_source_files(conn, parse_status="parsed")
    counts = {
        "files": 0, "skipped": 0, "total": 0,
        "resolved_merchants": 0, "unresolved_merchants": 0,
        "resolved_categories": 0, "unresolved_categories": 0,
    }

    for sf in parsed_files:
        if institution and sf["institution"] != institution:
            continue
        if account and sf["account_name"] != account:
            continue

        if not force and sf["enrich_status"] == "enriched":
            counts["skipped"] += 1
            continue

        file_hash = sf["file_hash"]
        txn_rows = _store.list_transactions(conn, source_file_hash=file_hash)

        enriched_txns = []
        resolved_merchants = 0
        unresolved_merchants = 0
        resolved_categories = 0
        unresolved_categories = 0

        for row in txn_rows:
            txn = _row_to_txn(row)
            enriched = engine.enrich(txn)
            enriched_txns.append(enriched)

            if enriched.merchant_rule_id:
                resolved_merchants += 1
            else:
                unresolved_merchants += 1

            if enriched.category_rule_id and enriched.category_normalized != "Uncategorized":
                resolved_categories += 1
            else:
                unresolved_categories += 1

        now = _now_iso()
        for etxn in enriched_txns:
            updates = {
                "merchant_normalized": etxn.merchant_normalized,
                "merchant_confidence": etxn.merchant_confidence,
                "merchant_rule_id": etxn.merchant_rule_id,
                "category_normalized": etxn.category_normalized,
                "category_confidence": etxn.category_confidence,
                "category_rule_id": etxn.category_rule_id,
                "subcategory_normalized": etxn.subcategory_normalized,
                "is_transfer_candidate": 1 if etxn.is_transfer_candidate else 0,
                "is_internal_payment_candidate": 1 if etxn.is_internal_payment_candidate else 0,
                "enriched_at": etxn.enriched_at.isoformat() if etxn.enriched_at else now,
            }
            _store.update_transaction_enrichment(conn, etxn.transaction_id, updates)
        conn.commit()

        _store.mark_source_file_enriched(
            conn, file_hash,
            len(enriched_txns), unresolved_merchants, unresolved_categories, now,
        )

        counts["files"] += 1
        counts["total"] += len(enriched_txns)
        counts["resolved_merchants"] += resolved_merchants
        counts["unresolved_merchants"] += unresolved_merchants
        counts["resolved_categories"] += resolved_categories
        counts["unresolved_categories"] += unresolved_categories

    _store.set_meta(conn, "enrichment_dirty", "0")
    _store.set_meta(conn, "last_enriched_at", _now_iso())

    _store._auto_export_vault(conn)

    logger.info(
        "Enrichment complete: %d files, %d transactions, %d unresolved merchants, "
        "%d unresolved categories",
        counts["files"], counts["total"],
        counts["unresolved_merchants"], counts["unresolved_categories"],
    )
    return counts


def run_transfer_matching(conn: sqlite3.Connection) -> dict[str, int]:
    """Match transfer pairs across all transactions and write results back to DB."""
    from ledgerlift.enrich.transfers import match_transfer_pairs

    _store.clear_transfer_pairs(conn)
    all_rows = _store.list_transactions(conn)
    all_txns = [_row_to_txn(row) for row in all_rows]

    before_paired = sum(1 for t in all_txns if t.transfer_pair_id)
    matched = match_transfer_pairs(all_txns)

    pair_updates: dict[str, tuple[str, float]] = {}
    for txn in matched:
        if txn.transfer_pair_id:
            pair_updates[txn.transaction_id] = (txn.transfer_pair_id, txn.transfer_match_confidence or 0.0)

    if pair_updates:
        _store.update_transfer_pairs(conn, pair_updates)

    pairs_found = len({v[0] for v in pair_updates.values()})
    logger.info("Transfer matching: %d pairs found", pairs_found)
    return {"pairs": pairs_found, "transactions_paired": len(pair_updates)}


def export(
    conn: sqlite3.Connection,
    net: bool = False,
) -> dict[str, int]:
    """Export all transactions from the store to CSV and JSON.

    If net=True, also exports versions excluding both sides of matched transfer pairs.
    """
    from ledgerlift.enrich.transfers import filter_net_transactions
    from ledgerlift.config import EXPORTS_DIR

    all_rows = _store.list_transactions(conn)
    all_txns = [_row_to_txn(row) for row in all_rows]

    before_count = len(all_txns)
    all_txns = deduplicate_transactions(all_txns)
    deduped_count = before_count - len(all_txns)

    all_txns = sort_transactions(all_txns)

    csv_path = export_csv(all_txns)
    json_path = export_json(all_txns)

    result = {
        "exported": len(all_txns),
        "deduplicated": deduped_count,
    }

    if net:
        net_txns = filter_net_transactions(all_txns)
        export_csv(net_txns, EXPORTS_DIR / "canonical_transactions_net.csv")
        export_json(net_txns, EXPORTS_DIR / "canonical_transactions_net.json")
        result["net_exported"] = len(net_txns)
        result["transfers_eliminated"] = len(all_txns) - len(net_txns)
        logger.info(
            "Net export: %d transactions (eliminated %d transfers)",
            len(net_txns), result["transfers_eliminated"],
        )

    logger.info(
        "Export complete: %d transactions (%d deduplicated), CSV: %s, JSON: %s",
        len(all_txns), deduped_count, csv_path, json_path,
    )
    return result
