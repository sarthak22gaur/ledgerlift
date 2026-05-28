"""Tests for src/ledgerlift/intake.py — verifies that account lookups read from SQLite."""

from __future__ import annotations

from pathlib import Path

import pytest


def test_load_account_map_reads_from_sqlite(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """_load_account_map() should return mappings from the SQLite accounts table,
    not from the filesystem."""
    import ledgerlift.store as store_module
    import ledgerlift.config as config_module

    # Point LEDGERLIFT_DB at a fresh temp DB so we don't touch the real one.
    db_file = tmp_path / "test.sqlite"
    monkeypatch.setenv("LEDGERLIFT_DB", str(db_file))
    # Ensure no accounts.yaml in the rules dir so migration is a no-op.
    rules_dir = tmp_path / "rules"
    rules_dir.mkdir()
    monkeypatch.setattr(config_module, "RULES_DIR", rules_dir)

    import importlib
    importlib.reload(store_module)

    try:
        store_module.init_db()
        conn = store_module.get_connection()

        # Insert a known mapping directly into the DB (simulating dashboard edit).
        conn.execute(
            "INSERT INTO accounts (last4, institution, account_name) "
            "VALUES ('4321', 'chase', 'checking')"
        )
        conn.commit()

        # Now call _load_account_map() — it should reflect the DB row.
        from ledgerlift.intake import _load_account_map
        account_map = _load_account_map()

        assert "4321" in account_map, "Expected last4 '4321' from SQLite accounts table"
        assert account_map["4321"] == ("chase", "checking")

    finally:
        monkeypatch.delenv("LEDGERLIFT_DB", raising=False)
        importlib.reload(store_module)


def test_load_account_lifecycle_reads_from_sqlite(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """load_account_lifecycle() should return lifecycle dates from the SQLite accounts table."""
    import ledgerlift.store as store_module
    import ledgerlift.config as config_module
    from datetime import date

    db_file = tmp_path / "test.sqlite"
    monkeypatch.setenv("LEDGERLIFT_DB", str(db_file))
    rules_dir = tmp_path / "rules"
    rules_dir.mkdir()
    monkeypatch.setattr(config_module, "RULES_DIR", rules_dir)

    import importlib
    importlib.reload(store_module)

    try:
        store_module.init_db()
        conn = store_module.get_connection()

        conn.execute(
            "INSERT INTO accounts (institution, account_name, opened_date, closed_date) "
            "VALUES ('mybank', 'savings', '2020-01-15', '2024-06-30')"
        )
        conn.commit()

        from ledgerlift.intake import load_account_lifecycle
        lifecycle = load_account_lifecycle()

        key = ("mybank", "savings")
        assert key in lifecycle, "Expected lifecycle entry for ('mybank', 'savings')"
        assert lifecycle[key]["opened_date"] == date(2020, 1, 15)
        assert lifecycle[key]["closed_date"] == date(2024, 6, 30)

    finally:
        monkeypatch.delenv("LEDGERLIFT_DB", raising=False)
        importlib.reload(store_module)


def test_load_account_map_returns_empty_when_no_accounts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """_load_account_map() returns {} when the accounts table is empty."""
    import ledgerlift.store as store_module
    import ledgerlift.config as config_module

    db_file = tmp_path / "test.sqlite"
    monkeypatch.setenv("LEDGERLIFT_DB", str(db_file))
    rules_dir = tmp_path / "rules"
    rules_dir.mkdir()
    monkeypatch.setattr(config_module, "RULES_DIR", rules_dir)

    import importlib
    importlib.reload(store_module)

    try:
        store_module.init_db()

        from ledgerlift.intake import _load_account_map
        account_map = _load_account_map()

        assert account_map == {}, f"Expected empty dict, got {account_map}"

    finally:
        monkeypatch.delenv("LEDGERLIFT_DB", raising=False)
        importlib.reload(store_module)
