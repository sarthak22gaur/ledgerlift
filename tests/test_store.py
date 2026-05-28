"""Tests for src/ledgerlift/store.py."""

from __future__ import annotations

import importlib
import sqlite3
from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _table_names(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()
    return {r[0] for r in rows}


def _get_version(conn: sqlite3.Connection) -> int | None:
    row = conn.execute("SELECT version FROM schema_versions LIMIT 1").fetchone()
    return row[0] if row else None


def _get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute(
        "SELECT value FROM pipeline_meta WHERE key = ?", (key,)
    ).fetchone()
    return row[0] if row else None


# ---------------------------------------------------------------------------
# Expected tables
# ---------------------------------------------------------------------------

EXPECTED_TABLES = {
    "schema_versions",
    "pipeline_meta",
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
}


# ---------------------------------------------------------------------------
# Tests: init_db
# ---------------------------------------------------------------------------


def test_init_db_creates_all_tables(tmp_path: Path) -> None:
    from ledgerlift.store import init_db, get_connection

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)

    conn = get_connection(db_file)
    tables = _table_names(conn)
    assert EXPECTED_TABLES.issubset(tables), (
        f"Missing tables: {EXPECTED_TABLES - tables}"
    )


def test_init_db_sets_schema_version_3(tmp_path: Path) -> None:
    from ledgerlift.store import init_db, get_connection

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)

    conn = get_connection(db_file)
    assert _get_version(conn) == 3


def test_init_db_sets_pipeline_meta_defaults(tmp_path: Path) -> None:
    from ledgerlift.store import init_db, get_connection

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)

    conn = get_connection(db_file)
    assert _get_meta(conn, "enrichment_dirty") == "0"
    # schema_initialized_at should be a non-empty ISO timestamp
    schema_ts = _get_meta(conn, "schema_initialized_at")
    assert schema_ts and len(schema_ts) > 0


def test_init_db_idempotent(tmp_path: Path) -> None:
    from ledgerlift.store import init_db, get_connection

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)

    conn = get_connection(db_file)
    conn.execute(
        "INSERT OR IGNORE INTO pipeline_meta(key, value) VALUES ('sentinel', 'alive')"
    )
    conn.commit()

    init_db(db_file)

    conn2 = get_connection(db_file)
    assert _get_meta(conn2, "enrichment_dirty") == "0"
    assert _get_meta(conn2, "sentinel") == "alive"
    assert _get_version(conn2) == 3


# ---------------------------------------------------------------------------
# Tests: seed — merchant rules
# ---------------------------------------------------------------------------


def test_init_db_seeds_merchant_rules_from_base_yaml(tmp_path: Path) -> None:
    from ledgerlift.store import init_db, get_connection

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)

    conn = get_connection(db_file)
    count = conn.execute(
        "SELECT COUNT(*) FROM merchant_rules WHERE source = 'base'"
    ).fetchone()[0]
    assert count > 0, "Expected merchant_rules rows seeded from merchants.base.yaml"


# ---------------------------------------------------------------------------
# Tests: duplicate-id dedup (last-wins)
# ---------------------------------------------------------------------------


def test_base_rule_duplicate_ids_are_deduped_last_wins(tmp_path: Path) -> None:
    """Seeding merchants.base.yaml produces exactly one row per id with no duplicates."""
    from ledgerlift.store import init_db, get_connection

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)

    conn = get_connection(db_file)
    dupes = conn.execute(
        "SELECT id, COUNT(*) AS cnt FROM merchant_rules WHERE source = 'base' GROUP BY id HAVING cnt > 1"
    ).fetchall()

    assert dupes == [], f"Duplicate base merchant rule ids found: {dupes}"

    row = conn.execute(
        "SELECT match_type, match_pattern FROM merchant_rules WHERE id = 'disney_plus' AND source = 'base'"
    ).fetchone()

    assert row is not None, "disney_plus base rule not found"
    assert row[0] == "regex", f"Expected match_type='regex', got '{row[0]}'"


# ---------------------------------------------------------------------------
# Tests: user row survives re-seed (INSERT OR IGNORE)
# ---------------------------------------------------------------------------


def test_user_rule_survives_re_seed(tmp_path: Path) -> None:
    from ledgerlift.store import init_db, get_connection

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)

    conn = get_connection(db_file)

    conn.execute(
        """
        INSERT INTO merchant_rules
            (id, priority, match_type, match_pattern, canonical_merchant, source)
        VALUES ('disney_plus', 999, 'exact', 'MY CUSTOM PATTERN', 'Disney+ Custom', 'user')
        """
    )
    conn.commit()

    row = conn.execute(
        "SELECT source, match_pattern FROM merchant_rules WHERE id = 'disney_plus' AND source = 'user'"
    ).fetchone()
    assert row[0] == "user"
    assert row[1] == "MY CUSTOM PATTERN"

    init_db(db_file)

    conn2 = get_connection(db_file)
    row2 = conn2.execute(
        "SELECT source, match_pattern FROM merchant_rules WHERE id = 'disney_plus' AND source = 'user'"
    ).fetchone()
    assert row2[0] == "user", "User source should survive re-seed"
    assert row2[1] == "MY CUSTOM PATTERN", "User pattern should survive re-seed"


# ---------------------------------------------------------------------------
# Tests: reset_db
# ---------------------------------------------------------------------------


def test_reset_db_wipes_and_recreates(tmp_path: Path) -> None:
    from ledgerlift.store import init_db, reset_db, get_connection

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)

    conn = get_connection(db_file)
    conn.execute(
        "INSERT INTO pipeline_meta(key, value) VALUES ('canary', 'present')"
    )
    conn.commit()

    reset_db(db_file)

    conn2 = get_connection(db_file)
    assert _get_meta(conn2, "canary") is None, "canary row should not survive reset"
    assert EXPECTED_TABLES.issubset(_table_names(conn2))
    assert _get_version(conn2) == 3


# ---------------------------------------------------------------------------
# Tests: LEDGERLIFT_DB env var
# ---------------------------------------------------------------------------


def test_ledgerlift_db_env_var_is_respected(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """When LEDGERLIFT_DB is set, resolve_db_path() should return that path."""
    import ledgerlift.store as store_module

    custom_path = tmp_path / "custom" / "my.sqlite"
    monkeypatch.setenv("LEDGERLIFT_DB", str(custom_path))
    importlib.reload(store_module)

    try:
        resolved = store_module.resolve_db_path()
        assert resolved == custom_path.resolve()
    finally:
        # Always reload to clean state after test.
        monkeypatch.delenv("LEDGERLIFT_DB", raising=False)
        importlib.reload(store_module)


def test_ledgerlift_db_env_var_init_creates_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """init_db() should create the file at the path pointed to by LEDGERLIFT_DB."""
    import ledgerlift.store as store_module

    custom_path = tmp_path / "envdb" / "ledgerlift.sqlite"
    monkeypatch.setenv("LEDGERLIFT_DB", str(custom_path))
    importlib.reload(store_module)

    try:
        returned = store_module.init_db()
        assert returned == custom_path.resolve()
        assert custom_path.exists()
    finally:
        monkeypatch.delenv("LEDGERLIFT_DB", raising=False)
        importlib.reload(store_module)


# ---------------------------------------------------------------------------
# Tests: _migrate_accounts_yaml
# ---------------------------------------------------------------------------

_SAMPLE_ACCOUNTS_YAML = """\
accounts:
  - last4: "1234"
    institution: chase
    account: checking

  - last4: "5678"
    institution: capitalone
    account: credit

  - institution: oldbank
    account: savings
    opened_date: "2019-06-01"
    closed_date: "2023-12-31"
"""


def _write_accounts_yaml(directory: Path, content: str) -> Path:
    path = directory / "accounts.yaml"
    path.write_text(content)
    return path


def test_migrate_accounts_yaml_populates_table(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """_migrate_accounts_yaml populates the accounts table from a valid YAML file."""
    import ledgerlift.config as config_module
    from ledgerlift.store import _migrate_accounts_yaml, init_db, get_connection

    rules_dir = tmp_path / "rules"
    rules_dir.mkdir()
    _write_accounts_yaml(rules_dir, _SAMPLE_ACCOUNTS_YAML)
    monkeypatch.setattr(config_module, "RULES_DIR", rules_dir)

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)
    conn = get_connection(db_file)

    rows = conn.execute("SELECT last4, institution, account_name FROM accounts").fetchall()
    assert len(rows) == 3

    by_last4 = {r["last4"]: (r["institution"], r["account_name"]) for r in rows if r["last4"]}
    assert by_last4["1234"] == ("chase", "checking")
    assert by_last4["5678"] == ("capitalone", "credit")

    # Entry without last4 should have institution + account_name set
    no_last4 = [r for r in rows if r["last4"] is None]
    assert len(no_last4) == 1
    assert no_last4[0]["institution"] == "oldbank"
    assert no_last4[0]["account_name"] == "savings"


def test_migrate_accounts_yaml_idempotent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Calling init_db twice does not duplicate accounts rows."""
    import ledgerlift.config as config_module
    from ledgerlift.store import init_db, get_connection

    rules_dir = tmp_path / "rules"
    rules_dir.mkdir()
    _write_accounts_yaml(rules_dir, _SAMPLE_ACCOUNTS_YAML)
    monkeypatch.setattr(config_module, "RULES_DIR", rules_dir)

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)
    init_db(db_file)  # second call — must not duplicate

    conn = get_connection(db_file)
    count = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    assert count == 3, f"Expected 3 rows after two init_db calls, got {count}"


def test_migrate_accounts_yaml_skipped_when_table_has_rows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If the accounts table already has rows, the YAML is NOT re-imported."""
    import ledgerlift.config as config_module
    from ledgerlift.store import _migrate_accounts_yaml, init_db, get_connection

    rules_dir = tmp_path / "rules"
    rules_dir.mkdir()
    _write_accounts_yaml(rules_dir, _SAMPLE_ACCOUNTS_YAML)
    monkeypatch.setattr(config_module, "RULES_DIR", rules_dir)

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)
    conn = get_connection(db_file)

    # Manually clear and insert a single sentinel row to simulate "already populated"
    conn.execute("DELETE FROM accounts")
    conn.execute(
        "INSERT INTO accounts (last4, institution, account_name) VALUES ('9999', 'mybank', 'checking')"
    )
    conn.commit()

    # Now run the migration again — it should no-op because the table has 1 row
    _migrate_accounts_yaml(conn)

    count = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    assert count == 1, (
        "YAML should not be re-imported when the accounts table already has rows; "
        f"expected 1 row, got {count}"
    )


def test_migrate_accounts_yaml_noop_when_file_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If accounts.yaml does not exist, init_db completes without error and leaves accounts empty."""
    import ledgerlift.config as config_module
    from ledgerlift.store import init_db, get_connection

    rules_dir = tmp_path / "rules"
    rules_dir.mkdir()
    # Do NOT write accounts.yaml
    monkeypatch.setattr(config_module, "RULES_DIR", rules_dir)

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)  # must not raise

    conn = get_connection(db_file)
    count = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    assert count == 0


def test_reset_derived_state_clears_only_derived_tables(tmp_path: Path) -> None:
    from ledgerlift.store import init_db, get_connection, reset_derived_state

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)
    conn = get_connection(db_file)

    conn.execute(
        "INSERT INTO source_files (file_hash, relative_path, institution, account_name)"
        " VALUES ('sf1', 'raw/bank/f.pdf', 'bank', 'checking')"
    )
    conn.execute(
        "INSERT INTO statements (id, source_file_hash, institution, account_name,"
        " account_type, parser_name, parser_version)"
        " VALUES ('stmt1', 'sf1', 'bank', 'checking', 'checking', 'p', '1')"
    )
    conn.execute(
        "INSERT INTO raw_transactions (statement_id, transaction_date, description, amount)"
        " VALUES ('stmt1', '2024-01-01', 'foo', 10.0)"
    )
    conn.execute(
        "INSERT INTO transactions (transaction_id, source_file_hash, institution,"
        " account_name, account_type, transaction_date, description_raw,"
        " description_normalized, amount, direction, transaction_type,"
        " parser_name, parser_version, import_timestamp)"
        " VALUES ('t1', 'sf1', 'bank', 'checking', 'checking', '2024-01-01',"
        " 'foo', 'foo', 10.0, 'debit', 'purchase', 'p', '1', '2024-01-01T00:00:00')"
    )
    mr_before = conn.execute("SELECT COUNT(*) FROM merchant_rules").fetchone()[0]
    cr_before = conn.execute("SELECT COUNT(*) FROM category_rules").fetchone()[0]
    conn.execute(
        "INSERT INTO accounts (last4, institution, account_name) VALUES ('1234', 'bank', 'checking')"
    )
    conn.execute(
        "INSERT OR IGNORE INTO internal_counterparties (name) VALUES ('test-counterparty')"
    )
    conn.commit()

    reset_derived_state(conn)

    assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM raw_transactions").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM statements").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM source_files").fetchone()[0] == 0

    assert conn.execute("SELECT COUNT(*) FROM merchant_rules").fetchone()[0] == mr_before
    assert conn.execute("SELECT COUNT(*) FROM category_rules").fetchone()[0] == cr_before
    assert conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM internal_counterparties WHERE name='test-counterparty'").fetchone()[0] == 1


def test_reset_derived_state_resets_pipeline_meta(tmp_path: Path) -> None:
    from ledgerlift.store import init_db, get_connection, reset_derived_state, set_meta

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)
    conn = get_connection(db_file)

    set_meta(conn, "enrichment_dirty", "1")
    set_meta(conn, "last_enriched_at", "2024-01-01T12:00:00+00:00")

    reset_derived_state(conn)

    assert _get_meta(conn, "enrichment_dirty") == "0"
    assert _get_meta(conn, "last_enriched_at") == ""


def test_clear_transfer_pairs_nulls_both_columns(tmp_path: Path) -> None:
    from ledgerlift.store import init_db, get_connection, clear_transfer_pairs

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)
    conn = get_connection(db_file)

    conn.execute(
        "INSERT INTO source_files (file_hash, relative_path, institution, account_name)"
        " VALUES ('hash1', 'fake.csv', 'Test Bank', 'Checking')"
    )
    conn.executemany(
        """
        INSERT INTO transactions (
            transaction_id, source_file_hash, institution, account_name, account_type,
            transaction_date, description_raw, description_normalized, amount, direction,
            transaction_type, parser_name, parser_version, import_timestamp,
            transfer_pair_id, transfer_match_confidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            ("txn-a", "hash1", "Test Bank", "Checking", "checking",
             "2024-01-01", "Transfer out", "transfer out", 100.0, "debit",
             "transfer", "test", "1.0", "2024-01-01T00:00:00", "abc", 0.9),
            ("txn-b", "hash1", "Test Bank", "Savings", "savings",
             "2024-01-01", "Transfer in", "transfer in", 100.0, "credit",
             "transfer", "test", "1.0", "2024-01-01T00:00:00", "abc", 0.9),
        ],
    )
    conn.commit()

    clear_transfer_pairs(conn)

    rows = conn.execute(
        "SELECT transfer_pair_id, transfer_match_confidence FROM transactions ORDER BY transaction_id"
    ).fetchall()
    assert len(rows) == 2
    for pair_id, confidence in rows:
        assert pair_id is None
        assert confidence is None




def test_listing_returns_all_rules_by_priority(tmp_path: Path) -> None:
    from ledgerlift.store import init_db, get_connection, list_merchant_rules

    db_file = tmp_path / "test.sqlite"
    init_db(db_file)
    conn = get_connection(db_file)

    conn.execute(
        """
        INSERT INTO merchant_rules
            (id, priority, match_type, match_pattern, canonical_merchant, source)
        VALUES ('zelle', 999, 'contains', 'zelle', 'Zelle Modified', 'user')
        """
    )
    conn.commit()

    rules = list_merchant_rules(conn)
    zelle_entries = [r for r in rules if r["id"] == "zelle"]
    assert len(zelle_entries) == 2, "Both base and user zelle rows must appear in listing"
    user_entry = next(r for r in zelle_entries if r["source"] == "user")
    assert user_entry["canonical_merchant"] == "Zelle Modified"
    assert "rule_id" in user_entry, "rule_id must be present in listing output"

    user_rule_id = conn.execute(
        "SELECT rule_id FROM merchant_rules WHERE id='zelle' AND source='user'"
    ).fetchone()[0]
    conn.execute("DELETE FROM merchant_rules WHERE rule_id = ?", (user_rule_id,))
    conn.commit()

    rules2 = list_merchant_rules(conn)
    zelle_entries2 = [r for r in rules2 if r["id"] == "zelle"]
    assert len(zelle_entries2) == 1
    assert zelle_entries2[0]["source"] == "base"


def test_duplicate_ids_preserved_on_import(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import ledgerlift.store as store_module

    db_file = tmp_path / "test.sqlite"
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "merchants.yaml").write_text(
        "rules:\n"
        "  - id: dominos\n"
        "    priority: 100\n"
        "    match:\n"
        "      type: regex\n"
        "      pattern: domino.s pizza\n"
        "    canonical_merchant: Dominos\n"
        "  - id: dominos\n"
        "    priority: 90\n"
        "    match:\n"
        "      type: contains\n"
        "      pattern: dominos\n"
        "    canonical_merchant: Dominos\n"
    )

    monkeypatch.setenv("LEDGERLIFT_DB", str(db_file))
    monkeypatch.setenv("LEDGERLIFT_VAULT", str(vault))
    importlib.reload(store_module)
    store_module.init_db()

    conn = store_module.get_connection(db_file)
    rows = conn.execute(
        "SELECT rule_id, match_type, match_pattern FROM merchant_rules WHERE id='dominos' AND source='user'"
    ).fetchall()

    assert len(rows) == 2, f"Both dominos rows must coexist; got {len(rows)}"
    rule_ids = {r["rule_id"] for r in rows}
    assert len(rule_ids) == 2, "Each row must have a distinct rule_id"


def test_schema_version_mismatch_drops_all_tables(tmp_path: Path) -> None:
    import sqlite3 as _sqlite3
    from ledgerlift.store import init_db, get_connection, CURRENT_SCHEMA_VERSION

    db_file = tmp_path / "v2.sqlite"

    raw = _sqlite3.connect(str(db_file))
    raw.row_factory = _sqlite3.Row
    raw.execute("CREATE TABLE schema_versions (version INTEGER NOT NULL)")
    raw.execute("INSERT INTO schema_versions(version) VALUES (2)")
    raw.execute("CREATE TABLE pipeline_meta (key TEXT PRIMARY KEY, value TEXT)")
    raw.execute("CREATE TABLE merchant_rules (id TEXT PRIMARY KEY, source TEXT)")
    raw.execute("INSERT INTO pipeline_meta VALUES ('canary', 'old')")
    raw.commit()
    raw.close()

    init_db(db_file)

    conn = get_connection(db_file)
    version = conn.execute("SELECT version FROM schema_versions LIMIT 1").fetchone()[0]
    assert version == CURRENT_SCHEMA_VERSION

    canary = conn.execute(
        "SELECT value FROM pipeline_meta WHERE key='canary'"
    ).fetchone()
    assert canary is None, "Old pipeline_meta rows must be gone after drop+recreate"

    col_names = {c["name"] for c in conn.execute("PRAGMA table_info(merchant_rules)").fetchall()}
    assert "rule_id" in col_names, "Recreated merchant_rules must have surrogate rule_id column"
