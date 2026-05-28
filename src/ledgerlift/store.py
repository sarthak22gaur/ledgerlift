from __future__ import annotations

import importlib
import json
import logging
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

CURRENT_SCHEMA_VERSION = 3

_SCHEMA_PATH = Path(__file__).parent / "schema.sql"

_DB_ENV_VAR = "LEDGERLIFT_DB"
_VAULT_ENV_VAR = "LEDGERLIFT_VAULT"

_VAULT_YAML_NAMES = (
    "merchants.yaml",
    "categories.yaml",
    "merchant_overrides.yaml",
    "category_overrides.yaml",
    "accounts.yaml",
    "internal_counterparties.yaml",
)


def vault_dir() -> Path | None:
    val = os.environ.get(_VAULT_ENV_VAR)
    return Path(val).expanduser().resolve() if val else None


def resolve_db_path(db_path: Path | None = None) -> Path:
    """Return the resolved path: explicit arg > $LEDGERLIFT_DB > $LEDGERLIFT_VAULT/ledgerlift.sqlite > default STATE_DIR."""
    if db_path is not None:
        return Path(db_path).expanduser().resolve()

    env_val = os.environ.get(_DB_ENV_VAR)
    if env_val:
        return Path(env_val).expanduser().resolve()

    vault = vault_dir()
    if vault is not None:
        return vault / "ledgerlift.sqlite"

    from ledgerlift.config import STATE_DIR  # noqa: PLC0415

    return STATE_DIR / "ledgerlift.sqlite"


_connection_cache: dict[Path, sqlite3.Connection] = {}


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    """Return a cached sqlite3.Connection. Explicit db_path bypasses the cache (test isolation)."""
    resolved = resolve_db_path(db_path)

    if db_path is not None:
        conn = _open_connection(resolved)
        return conn

    if resolved not in _connection_cache:
        _connection_cache[resolved] = _open_connection(resolved)
    return _connection_cache[resolved]


def _open_connection(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def _create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_SCHEMA_PATH.read_text())
    conn.commit()


def _get_schema_version(conn: sqlite3.Connection) -> int | None:
    row = conn.execute("SELECT version FROM schema_versions LIMIT 1").fetchone()
    return row[0] if row else None


def _set_schema_version(conn: sqlite3.Connection, version: int) -> None:
    conn.execute("DELETE FROM schema_versions")
    conn.execute("INSERT INTO schema_versions(version) VALUES (?)", (version,))
    conn.commit()


_ALL_TABLES = (
    "pipeline_meta",
    "schema_versions",
    "source_files",
    "statements",
    "raw_transactions",
    "transactions",
    "merchant_rules",
    "category_rules",
    "merchant_overrides",
    "category_overrides",
    "accounts",
    "internal_counterparties",
)


def _ensure_schema_version(conn: sqlite3.Connection) -> None:
    has_versions_table = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_versions'"
    ).fetchone()

    if not has_versions_table:
        return

    version = _get_schema_version(conn)
    if version is None or version == CURRENT_SCHEMA_VERSION:
        return

    logger.warning(
        "Schema version %s→%s mismatch — dropping all tables and recreating",
        version,
        CURRENT_SCHEMA_VERSION,
    )
    drop_script = "PRAGMA foreign_keys=OFF;\n"
    drop_script += "".join(f"DROP TABLE IF EXISTS {t};\n" for t in _ALL_TABLES)
    drop_script += "PRAGMA foreign_keys=ON;\n"
    conn.executescript(drop_script)
    _create_schema(conn)


_PIPELINE_META_DEFAULTS: dict[str, str] = {
    "enrichment_dirty": "0",
    "schema_initialized_at": "",  # filled in at init time
    "last_enriched_at": "",
}


def _init_pipeline_meta(conn: sqlite3.Connection) -> None:
    now = datetime.now(timezone.utc).isoformat()
    rows: list[tuple[str, str]] = [
        ("enrichment_dirty", "0"),
        ("schema_initialized_at", now),
        ("last_enriched_at", ""),
    ]
    conn.executemany(
        "INSERT OR IGNORE INTO pipeline_meta(key, value) VALUES (?, ?)",
        rows,
    )
    conn.commit()


def _load_yaml(path: Path) -> Any:
    with open(path) as fh:
        return yaml.safe_load(fh)


def _seed_base_rules(conn: sqlite3.Connection) -> None:
    from ledgerlift.config import (  # noqa: PLC0415
        CATEGORY_RULES_BASE_PATH,
        MERCHANT_RULES_BASE_PATH,
        RULES_DIR,
    )

    if MERCHANT_RULES_BASE_PATH.exists():
        existing = conn.execute(
            "SELECT COUNT(*) FROM merchant_rules WHERE source='base'"
        ).fetchone()[0]
        if existing == 0:
            data = _load_yaml(MERCHANT_RULES_BASE_PATH)
            raw_rules: list[dict[str, Any]] = data.get("rules", []) if data else []

            deduped: dict[str, dict[str, Any]] = {}
            for rule in raw_rules:
                deduped[rule["id"]] = rule

            rows = []
            for rule in deduped.values():
                match = rule.get("match", {})
                rows.append(
                    (
                        rule["id"],
                        rule.get("priority", 0),
                        match.get("type", ""),
                        match.get("pattern", ""),
                        rule.get("canonical_merchant", ""),
                        rule.get("category"),
                        rule.get("subcategory"),
                        "base",
                    )
                )

            conn.executemany(
                """
                INSERT INTO merchant_rules
                    (id, priority, match_type, match_pattern, canonical_merchant,
                     category, subcategory, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            conn.commit()
    else:
        logger.warning("Merchant base rules not found at %s — skipping seed", MERCHANT_RULES_BASE_PATH)

    if CATEGORY_RULES_BASE_PATH.exists():
        existing_cat = conn.execute(
            "SELECT COUNT(*) FROM category_rules WHERE source='base'"
        ).fetchone()[0]
        if existing_cat == 0:
            data = _load_yaml(CATEGORY_RULES_BASE_PATH)
            raw_rules = data.get("rules", []) if data else []

            deduped = {}
            for rule in raw_rules:
                deduped[rule["id"]] = rule

            rows_cat = []
            for rule in deduped.values():
                when = rule.get("when", {})
                assign = rule.get("assign", {})
                merchant_normalized = when.get("merchant_normalized")
                if isinstance(merchant_normalized, list):
                    merchant_normalized = json.dumps(merchant_normalized)

                txn_type = when.get("transaction_type")
                if isinstance(txn_type, list):
                    txn_type = json.dumps(txn_type)
                elif isinstance(txn_type, str):
                    txn_type = json.dumps([txn_type])

                rows_cat.append(
                    (
                        rule["id"],
                        rule.get("priority", 0),
                        merchant_normalized,
                        when.get("description_regex"),
                        txn_type,
                        when.get("direction"),
                        when.get("institution"),
                        when.get("account_name"),
                        assign.get("category", ""),
                        assign.get("subcategory"),
                        assign.get("confidence"),
                        "base",
                    )
                )

            conn.executemany(
                """
                INSERT INTO category_rules
                    (id, priority, when_merchant_normalized, when_description_regex,
                     when_transaction_type, when_direction, when_institution,
                     when_account_name, assign_category, assign_subcategory,
                     assign_confidence, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows_cat,
            )
            conn.commit()
    else:
        logger.warning("Category base rules not found at %s — skipping seed", CATEGORY_RULES_BASE_PATH)

    counterparties_path = RULES_DIR / "internal_counterparties.yaml"
    if counterparties_path.exists():
        data = _load_yaml(counterparties_path)
        names: list[str] = data.get("counterparties", []) if data else []
        if names:
            conn.executemany(
                "INSERT OR IGNORE INTO internal_counterparties(name) VALUES (?)",
                [(n,) for n in names],
            )
            conn.commit()
    else:
        logger.warning("internal_counterparties.yaml not found at %s — skipping seed", counterparties_path)


def _migrate_accounts_yaml(conn: sqlite3.Connection) -> None:
    """One-shot migration: import accounts.yaml into the accounts table.

    Called from init_db() after schema creation and base-rule seeding.
    No-ops if:
      - data/rules/accounts.yaml does not exist, OR
      - the accounts table already has rows (SQLite is already authoritative).
    """
    from ledgerlift.config import RULES_DIR  # noqa: PLC0415

    accounts_yaml_path = RULES_DIR / "accounts.yaml"

    if not accounts_yaml_path.exists():
        return

    count = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    if count > 0:
        return

    try:
        data = _load_yaml(accounts_yaml_path)
    except Exception:
        logger.exception("Failed to load %s — skipping accounts migration", accounts_yaml_path)
        return

    if not data or "accounts" not in data:
        return

    entries: list[dict[str, Any]] = list(data["accounts"])
    if not entries:
        return

    rows = []
    for entry in entries:
        rows.append((
            str(entry["last4"]) if entry.get("last4") is not None else None,
            entry.get("institution", ""),
            entry.get("account_name") or entry.get("account", ""),
            str(entry["opened_date"]) if entry.get("opened_date") is not None else None,
            str(entry["closed_date"]) if entry.get("closed_date") is not None else None,
        ))

    conn.executemany(
        """
        INSERT OR IGNORE INTO accounts (last4, institution, account_name, opened_date, closed_date)
        VALUES (?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()

    migrated = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    logger.info(
        "Migrated %d account(s) from %s into the SQLite accounts table. "
        "accounts.yaml is no longer read at runtime — edit accounts via the dashboard or "
        "`ledgerlift accounts import`.",
        migrated,
        accounts_yaml_path,
    )


def _import_merchants_yaml(conn: sqlite3.Connection, path: Path) -> int:
    data = _load_yaml(path)
    if not data:
        return 0
    raw_rules: list[dict[str, Any]] = data.get("rules", [])
    rows = []
    for rule in raw_rules:
        source = rule.get("_source", "user")
        if source != "user":
            continue
        match = rule.get("match", {})
        rows.append((
            rule["id"],
            rule.get("priority", 0),
            match.get("type", ""),
            match.get("pattern", ""),
            rule.get("canonical_merchant", ""),
            rule.get("category"),
            rule.get("subcategory"),
            "user",
        ))
    if not rows:
        return 0
    conn.executemany(
        """
        INSERT INTO merchant_rules
            (id, priority, match_type, match_pattern, canonical_merchant,
             category, subcategory, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def _import_categories_yaml(conn: sqlite3.Connection, path: Path) -> int:
    data = _load_yaml(path)
    if not data:
        return 0
    raw_rules: list[dict[str, Any]] = data.get("rules", [])
    rows = []
    for rule in raw_rules:
        source = rule.get("_source", "user")
        if source != "user":
            continue
        when = rule.get("when", {})
        assign = rule.get("assign", {})
        merchant_normalized = when.get("merchant_normalized")
        if isinstance(merchant_normalized, list):
            merchant_normalized = json.dumps(merchant_normalized)
        txn_type = when.get("transaction_type")
        if isinstance(txn_type, list):
            txn_type = json.dumps(txn_type)
        elif isinstance(txn_type, str):
            txn_type = json.dumps([txn_type])
        rows.append((
            rule["id"],
            rule.get("priority", 0),
            merchant_normalized,
            when.get("description_regex"),
            txn_type,
            when.get("direction"),
            when.get("institution"),
            when.get("account_name"),
            assign.get("category", ""),
            assign.get("subcategory"),
            assign.get("confidence"),
            "user",
        ))
    if not rows:
        return 0
    conn.executemany(
        """
        INSERT INTO category_rules
            (id, priority, when_merchant_normalized, when_description_regex,
             when_transaction_type, when_direction, when_institution,
             when_account_name, assign_category, assign_subcategory,
             assign_confidence, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()
    return len(rows)


def _import_merchant_overrides_yaml(conn: sqlite3.Connection, path: Path) -> int:
    data = _load_yaml(path)
    if not data:
        return 0
    entries: list[dict[str, Any]] = data.get("overrides", [])
    if not entries:
        return 0
    rows = [(e["transaction_id"], e.get("canonical_merchant"), e.get("category"), e.get("subcategory")) for e in entries if "transaction_id" in e]
    if not rows:
        return 0
    conn.executemany(
        "INSERT OR IGNORE INTO merchant_overrides (transaction_id, canonical_merchant, category, subcategory) VALUES (?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    return len(rows)


def _import_category_overrides_yaml(conn: sqlite3.Connection, path: Path) -> int:
    data = _load_yaml(path)
    if not data:
        return 0
    entries: list[dict[str, Any]] = data.get("overrides", [])
    if not entries:
        return 0
    rows = [(e["transaction_id"], e.get("category"), e.get("subcategory")) for e in entries if "transaction_id" in e]
    if not rows:
        return 0
    conn.executemany(
        "INSERT OR IGNORE INTO category_overrides (transaction_id, category, subcategory) VALUES (?, ?, ?)",
        rows,
    )
    conn.commit()
    return len(rows)


def _import_accounts_yaml_from_path(conn: sqlite3.Connection, path: Path) -> int:
    try:
        data = _load_yaml(path)
    except Exception:
        logger.exception("Failed to load %s — skipping accounts import", path)
        return 0
    if not data or "accounts" not in data:
        return 0
    entries: list[dict[str, Any]] = list(data["accounts"])
    if not entries:
        return 0
    rows = []
    for entry in entries:
        rows.append((
            str(entry["last4"]) if entry.get("last4") is not None else None,
            entry.get("institution", ""),
            entry.get("account_name") or entry.get("account", ""),
            str(entry["opened_date"]) if entry.get("opened_date") is not None else None,
            str(entry["closed_date"]) if entry.get("closed_date") is not None else None,
        ))
    conn.executemany(
        "INSERT OR IGNORE INTO accounts (last4, institution, account_name, opened_date, closed_date) VALUES (?, ?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    return len(rows)


def _import_counterparties_yaml(conn: sqlite3.Connection, path: Path) -> int:
    data = _load_yaml(path)
    if not data:
        return 0
    names: list[str] = data.get("counterparties", [])
    if not names:
        return 0
    conn.executemany(
        "INSERT OR IGNORE INTO internal_counterparties(name) VALUES (?)",
        [(n,) for n in names],
    )
    conn.commit()
    return len(names)


def _import_vault_yamls(conn: sqlite3.Connection) -> None:
    vault = vault_dir()
    if vault is None:
        return

    mr_count = 0
    cr_count = 0
    mo_count = 0
    co_count = 0
    acc_count = 0
    ic_count = 0

    merchants_path = vault / "merchants.yaml"
    if merchants_path.exists():
        existing = conn.execute("SELECT COUNT(*) FROM merchant_rules WHERE source='user'").fetchone()[0]
        if existing == 0:
            mr_count = _import_merchants_yaml(conn, merchants_path)

    categories_path = vault / "categories.yaml"
    if categories_path.exists():
        existing = conn.execute("SELECT COUNT(*) FROM category_rules WHERE source='user'").fetchone()[0]
        if existing == 0:
            cr_count = _import_categories_yaml(conn, categories_path)

    mo_path = vault / "merchant_overrides.yaml"
    if mo_path.exists():
        existing = conn.execute("SELECT COUNT(*) FROM merchant_overrides").fetchone()[0]
        if existing == 0:
            mo_count = _import_merchant_overrides_yaml(conn, mo_path)

    co_path = vault / "category_overrides.yaml"
    if co_path.exists():
        existing = conn.execute("SELECT COUNT(*) FROM category_overrides").fetchone()[0]
        if existing == 0:
            co_count = _import_category_overrides_yaml(conn, co_path)

    acc_path = vault / "accounts.yaml"
    if acc_path.exists():
        existing = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
        if existing == 0:
            acc_count = _import_accounts_yaml_from_path(conn, acc_path)

    ic_path = vault / "internal_counterparties.yaml"
    if ic_path.exists():
        existing = conn.execute("SELECT COUNT(*) FROM internal_counterparties").fetchone()[0]
        if existing == 0:
            ic_count = _import_counterparties_yaml(conn, ic_path)

    if any([mr_count, cr_count, mo_count, co_count, acc_count, ic_count]):
        logger.info(
            "Auto-imported from vault: %d merchant rules, %d category rules, "
            "%d merchant overrides, %d category overrides, %d accounts, %d counterparties",
            mr_count, cr_count, mo_count, co_count, acc_count, ic_count,
        )


def _auto_export_vault(conn: sqlite3.Connection) -> None:
    vault = vault_dir()
    if vault is None:
        return
    if os.environ.get(_DB_ENV_VAR):
        return

    try:
        _write_vault_yamls(conn, vault)
        logger.info("Vault YAMLs synced to %s", vault)
    except Exception:
        logger.warning("Vault YAML export failed — enrichment results are still saved", exc_info=True)


def _write_vault_yamls(conn: sqlite3.Connection, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)

    mr_rows = conn.execute(
        """
        SELECT u.* FROM merchant_rules u
        WHERE u.source='user' AND NOT EXISTS (
            SELECT 1 FROM merchant_rules b
            WHERE b.source='base'
              AND b.id = u.id
              AND b.priority = u.priority
              AND b.match_type = u.match_type
              AND b.match_pattern = u.match_pattern
              AND b.canonical_merchant = u.canonical_merchant
              AND IFNULL(b.category,'') = IFNULL(u.category,'')
              AND IFNULL(b.subcategory,'') = IFNULL(u.subcategory,'')
        )
        """
    ).fetchall()
    mr_data: dict[str, Any] = {
        "rules": [
            {
                "id": r["id"],
                "priority": r["priority"],
                "match": {"type": r["match_type"], "pattern": r["match_pattern"]},
                "canonical_merchant": r["canonical_merchant"],
                **({"category": r["category"]} if r["category"] else {}),
                **({"subcategory": r["subcategory"]} if r["subcategory"] else {}),
            }
            for r in mr_rows
        ]
    }
    (out / "merchants.yaml").write_text(yaml.dump(mr_data, allow_unicode=True, sort_keys=False))

    cr_rows = conn.execute(
        """
        SELECT u.* FROM category_rules u
        WHERE u.source='user' AND NOT EXISTS (
            SELECT 1 FROM category_rules b
            WHERE b.source='base'
              AND b.id = u.id
              AND b.priority = u.priority
              AND IFNULL(b.when_merchant_normalized,'') = IFNULL(u.when_merchant_normalized,'')
              AND IFNULL(b.when_description_regex,'') = IFNULL(u.when_description_regex,'')
              AND IFNULL(b.when_transaction_type,'') = IFNULL(u.when_transaction_type,'')
              AND IFNULL(b.when_direction,'') = IFNULL(u.when_direction,'')
              AND IFNULL(b.when_institution,'') = IFNULL(u.when_institution,'')
              AND IFNULL(b.when_account_name,'') = IFNULL(u.when_account_name,'')
              AND b.assign_category = u.assign_category
              AND IFNULL(b.assign_subcategory,'') = IFNULL(u.assign_subcategory,'')
              AND IFNULL(b.assign_confidence,0) = IFNULL(u.assign_confidence,0)
        )
        """
    ).fetchall()
    cr_list = []
    for r in cr_rows:
        merchant_norm = r["when_merchant_normalized"]
        if merchant_norm:
            try:
                merchant_norm = json.loads(merchant_norm)
            except (json.JSONDecodeError, TypeError):
                merchant_norm = [merchant_norm]
        txn_type = r["when_transaction_type"]
        if txn_type:
            try:
                txn_type = json.loads(txn_type)
            except (json.JSONDecodeError, TypeError):
                txn_type = [txn_type]
        when = {k: v for k, v in {
            "merchant_normalized": merchant_norm,
            "description_regex": r["when_description_regex"],
            "transaction_type": txn_type,
            "direction": r["when_direction"],
            "institution": r["when_institution"],
            "account_name": r["when_account_name"],
        }.items() if v is not None}
        assign = {k: v for k, v in {
            "category": r["assign_category"],
            "subcategory": r["assign_subcategory"],
            "confidence": r["assign_confidence"],
        }.items() if v is not None}
        cr_list.append({"id": r["id"], "priority": r["priority"], "when": when, "assign": assign})
    cr_data: dict[str, Any] = {"rules": cr_list}
    (out / "categories.yaml").write_text(yaml.dump(cr_data, allow_unicode=True, sort_keys=False))

    mo_rows = conn.execute("SELECT * FROM merchant_overrides").fetchall()
    mo_data: dict[str, Any] = {"overrides": [dict(r) for r in mo_rows]}
    (out / "merchant_overrides.yaml").write_text(yaml.dump(mo_data, allow_unicode=True, sort_keys=False))

    co_rows = conn.execute("SELECT * FROM category_overrides").fetchall()
    co_data: dict[str, Any] = {"overrides": [dict(r) for r in co_rows]}
    (out / "category_overrides.yaml").write_text(yaml.dump(co_data, allow_unicode=True, sort_keys=False))

    acc_rows = conn.execute(
        "SELECT last4, institution, account_name, opened_date, closed_date FROM accounts"
    ).fetchall()
    acc_data: dict[str, Any] = {
        "accounts": [{k: v for k, v in dict(r).items() if v is not None} for r in acc_rows]
    }
    (out / "accounts.yaml").write_text(yaml.dump(acc_data, allow_unicode=True, sort_keys=False))

    ic_names = [r[0] for r in conn.execute("SELECT name FROM internal_counterparties").fetchall()]
    ic_data: dict[str, Any] = {"counterparties": ic_names}
    (out / "internal_counterparties.yaml").write_text(yaml.dump(ic_data, allow_unicode=True, sort_keys=False))


def init_db(db_path: Path | None = None) -> Path:
    resolved = resolve_db_path(db_path)
    resolved.parent.mkdir(parents=True, exist_ok=True)

    conn = get_connection(db_path)

    _ensure_schema_version(conn)
    _create_schema(conn)

    version = _get_schema_version(conn)
    if version is None:
        _set_schema_version(conn, CURRENT_SCHEMA_VERSION)

    _init_pipeline_meta(conn)
    _seed_base_rules(conn)
    _migrate_accounts_yaml(conn)
    _import_vault_yamls(conn)

    return resolved


def reset_derived_state(conn: sqlite3.Connection) -> None:
    """Delete all derived pipeline state while preserving config and seeded rules."""
    conn.execute("DELETE FROM transactions")
    conn.execute("DELETE FROM raw_transactions")
    conn.execute("DELETE FROM statements")
    conn.execute("DELETE FROM source_files")
    conn.execute(
        "INSERT OR REPLACE INTO pipeline_meta (key, value) VALUES ('enrichment_dirty', '0')"
    )
    conn.execute(
        "INSERT OR REPLACE INTO pipeline_meta (key, value) VALUES ('last_enriched_at', '')"
    )
    conn.commit()


def reset_db(db_path: Path | None = None) -> Path:
    """Delete the database file and re-initialise from scratch."""
    resolved = resolve_db_path(db_path)

    if resolved in _connection_cache:
        try:
            _connection_cache.pop(resolved).close()
        except Exception:
            pass

    if resolved.exists():
        resolved.unlink()

    return init_db(db_path)


def upsert_source_file(
    conn: sqlite3.Connection,
    file_hash: str,
    relative_path: str,
    institution: str,
    account_name: str,
) -> None:
    conn.execute(
        """
        INSERT INTO source_files (file_hash, relative_path, institution, account_name,
                                  parse_status, enrich_status)
        VALUES (?, ?, ?, ?, 'pending', 'pending')
        ON CONFLICT(file_hash) DO UPDATE SET
            relative_path = excluded.relative_path
        """,
        (file_hash, relative_path, institution, account_name),
    )
    conn.commit()


def mark_source_file_parsed(
    conn: sqlite3.Connection,
    file_hash: str,
    now_iso: str,
) -> None:
    conn.execute(
        """
        UPDATE source_files
        SET parse_status = 'parsed', parsed_at = ?, parse_error = NULL, enrich_status = 'pending'
        WHERE file_hash = ?
        """,
        (now_iso, file_hash),
    )
    conn.commit()


def mark_source_file_failed(
    conn: sqlite3.Connection,
    file_hash: str,
    error: str,
    now_iso: str,
) -> None:
    conn.execute(
        """
        UPDATE source_files
        SET parse_status = 'failed', parsed_at = ?, parse_error = ?
        WHERE file_hash = ?
        """,
        (now_iso, error, file_hash),
    )
    conn.commit()


def mark_source_file_enriched(
    conn: sqlite3.Connection,
    file_hash: str,
    enriched_count: int,
    unresolved_merchant_count: int,
    unresolved_category_count: int,
    now_iso: str,
) -> None:
    conn.execute(
        """
        UPDATE source_files
        SET enrich_status = 'enriched', enriched_at = ?,
            enriched_transaction_count = ?,
            unresolved_merchant_count = ?,
            unresolved_category_count = ?
        WHERE file_hash = ?
        """,
        (now_iso, enriched_count, unresolved_merchant_count, unresolved_category_count, file_hash),
    )
    conn.commit()


def get_source_file(
    conn: sqlite3.Connection, file_hash: str
) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM source_files WHERE file_hash = ?", (file_hash,)
    ).fetchone()


def list_source_files(
    conn: sqlite3.Connection,
    parse_status: str | None = None,
    institution: str | None = None,
    account_name: str | None = None,
) -> list[sqlite3.Row]:
    """Return source_files rows, optionally filtered."""
    clauses = []
    params: list[Any] = []
    if parse_status:
        clauses.append("parse_status = ?")
        params.append(parse_status)
    if institution:
        clauses.append("institution = ?")
        params.append(institution)
    if account_name:
        clauses.append("account_name = ?")
        params.append(account_name)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    return conn.execute(f"SELECT * FROM source_files {where}", params).fetchall()


def upsert_transactions(
    conn: sqlite3.Connection,
    rows: list[dict[str, Any]],
) -> None:
    if not rows:
        return
    placeholders = ", ".join(["?"] * len(rows[0]))
    columns = ", ".join(rows[0].keys())
    conn.executemany(
        f"INSERT OR REPLACE INTO transactions ({columns}) VALUES ({placeholders})",
        [list(r.values()) for r in rows],
    )
    conn.commit()


def delete_transactions_for_file(
    conn: sqlite3.Connection, file_hash: str
) -> None:
    conn.execute(
        "DELETE FROM transactions WHERE source_file_hash = ?", (file_hash,)
    )
    conn.commit()


def list_transactions(
    conn: sqlite3.Connection,
    source_file_hash: str | None = None,
    enrich_status_filter: str | None = None,
) -> list[sqlite3.Row]:
    clauses = []
    params: list[Any] = []
    if source_file_hash:
        clauses.append("source_file_hash = ?")
        params.append(source_file_hash)
    if enrich_status_filter:
        clauses.append(
            "source_file_hash IN (SELECT file_hash FROM source_files WHERE enrich_status = ?)"
        )
        params.append(enrich_status_filter)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    return conn.execute(f"SELECT * FROM transactions {where}", params).fetchall()


def update_transaction_enrichment(
    conn: sqlite3.Connection,
    transaction_id: str,
    updates: dict[str, Any],
) -> None:
    if not updates:
        return
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    params = list(updates.values()) + [transaction_id]
    conn.execute(
        f"UPDATE transactions SET {set_clause} WHERE transaction_id = ?",
        params,
    )


def update_transfer_pairs(
    conn: sqlite3.Connection,
    pair_updates: dict[str, tuple[str, float]],
) -> None:
    rows = [
        (pair_id, confidence, txn_id)
        for txn_id, (pair_id, confidence) in pair_updates.items()
    ]
    conn.executemany(
        """
        UPDATE transactions
        SET transfer_pair_id = ?, transfer_match_confidence = ?
        WHERE transaction_id = ?
        """,
        rows,
    )
    conn.commit()


def clear_transfer_pairs(conn: sqlite3.Connection) -> None:
    conn.execute(
        "UPDATE transactions SET transfer_pair_id = NULL, transfer_match_confidence = NULL"
    )
    conn.commit()


def upsert_statement(
    conn: sqlite3.Connection,
    stmt: dict[str, Any],
) -> None:
    columns = ", ".join(stmt.keys())
    placeholders = ", ".join(["?"] * len(stmt))
    conn.execute(
        f"INSERT OR REPLACE INTO statements ({columns}) VALUES ({placeholders})",
        list(stmt.values()),
    )
    conn.commit()


def insert_raw_transactions(
    conn: sqlite3.Connection,
    rows: list[dict[str, Any]],
) -> None:
    if not rows:
        return
    if rows:
        stmt_id = rows[0].get("statement_id")
        if stmt_id:
            conn.execute(
                "DELETE FROM raw_transactions WHERE statement_id = ?", (stmt_id,)
            )
    placeholders = ", ".join(["?"] * len(rows[0]))
    columns = ", ".join(rows[0].keys())
    conn.executemany(
        f"INSERT INTO raw_transactions ({columns}) VALUES ({placeholders})",
        [list(r.values()) for r in rows],
    )
    conn.commit()


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute(
        "SELECT value FROM pipeline_meta WHERE key = ?", (key,)
    ).fetchone()
    return row[0] if row else None


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO pipeline_meta (key, value) VALUES (?, ?)",
        (key, value),
    )
    conn.commit()


def list_merchant_rules(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT rule_id, id, priority, match_type, match_pattern,
               canonical_merchant, category, subcategory, source
        FROM merchant_rules
        ORDER BY priority DESC, rule_id ASC
        """
    ).fetchall()
    return [
        {
            "rule_id": row["rule_id"],
            "id": row["id"],
            "priority": row["priority"],
            "match": {
                "type": row["match_type"],
                "pattern": row["match_pattern"],
            },
            "canonical_merchant": row["canonical_merchant"],
            "category": row["category"],
            "subcategory": row["subcategory"],
            "source": row["source"],
        }
        for row in rows
    ]


def list_category_rules(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT rule_id, id, priority, when_merchant_normalized, when_description_regex,
               when_transaction_type, when_direction, when_institution, when_account_name,
               assign_category, assign_subcategory, assign_confidence, source
        FROM category_rules
        ORDER BY priority DESC, rule_id ASC
        """
    ).fetchall()
    result = []
    for row in rows:
        merchant_norm = row["when_merchant_normalized"]
        if merchant_norm:
            try:
                merchant_norm = json.loads(merchant_norm)
            except (json.JSONDecodeError, TypeError):
                merchant_norm = [merchant_norm]

        txn_type = row["when_transaction_type"]
        if txn_type:
            try:
                txn_type = json.loads(txn_type)
            except (json.JSONDecodeError, TypeError):
                txn_type = [txn_type]

        result.append({
            "rule_id": row["rule_id"],
            "id": row["id"],
            "priority": row["priority"],
            "when": {
                "merchant_normalized": merchant_norm,
                "description_regex": row["when_description_regex"],
                "transaction_type": txn_type,
                "direction": row["when_direction"],
                "institution": row["when_institution"],
                "account_name": row["when_account_name"],
            },
            "assign": {
                "category": row["assign_category"],
                "subcategory": row["assign_subcategory"],
                "confidence": row["assign_confidence"],
            },
            "source": row["source"],
        })
    return result


def list_merchant_overrides(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM merchant_overrides").fetchall()
    return [dict(row) for row in rows]


def list_category_overrides(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM category_overrides").fetchall()
    return [dict(row) for row in rows]


def list_internal_counterparties(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute("SELECT name FROM internal_counterparties").fetchall()
    return [row[0] for row in rows]
