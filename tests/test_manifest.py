"""Tests for source_file tracking via the SQLite store (replaces old Manifest tests)."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from ledgerlift.store import (
    get_connection,
    get_source_file,
    init_db,
    list_source_files,
    mark_source_file_enriched,
    mark_source_file_failed,
    mark_source_file_parsed,
    upsert_source_file,
)


class TestSourceFileTracking:
    def test_register_new_file(self, tmp_path: Path) -> None:
        db = tmp_path / "t.sqlite"
        init_db(db)
        conn = get_connection(db)
        upsert_source_file(conn, "abc123", "chase/checking/2023/stmt.pdf", "chase", "checking")
        row = get_source_file(conn, "abc123")
        assert row is not None
        assert row["file_hash"] == "abc123"
        assert row["parse_status"] == "pending"
        assert row["institution"] == "chase"
        assert row["account_name"] == "checking"

    def test_register_same_hash_is_idempotent(self, tmp_path: Path) -> None:
        db = tmp_path / "t.sqlite"
        init_db(db)
        conn = get_connection(db)
        upsert_source_file(conn, "abc123", "path/a.pdf", "chase", "checking")
        upsert_source_file(conn, "abc123", "path/a.pdf", "chase", "checking")
        rows = list_source_files(conn)
        # Only base-seed accounts in source_files; our two calls are same hash
        hashes = [r["file_hash"] for r in rows if r["file_hash"] == "abc123"]
        assert len(hashes) == 1

    def test_register_same_hash_updates_path(self, tmp_path: Path) -> None:
        db = tmp_path / "t.sqlite"
        init_db(db)
        conn = get_connection(db)
        upsert_source_file(conn, "abc123", "path/old.pdf", "chase", "checking")
        upsert_source_file(conn, "abc123", "path/new.pdf", "chase", "checking")
        row = get_source_file(conn, "abc123")
        assert row is not None
        assert row["relative_path"] == "path/new.pdf"

    def test_mark_parsed(self, tmp_path: Path) -> None:
        db = tmp_path / "t.sqlite"
        init_db(db)
        conn = get_connection(db)
        upsert_source_file(conn, "abc123", "path/a.pdf", "chase", "checking")
        mark_source_file_parsed(conn, "abc123", "2023-01-31T10:00:00")
        row = get_source_file(conn, "abc123")
        assert row is not None
        assert row["parse_status"] == "parsed"
        assert row["parsed_at"] == "2023-01-31T10:00:00"
        assert row["parse_error"] is None

    def test_mark_failed(self, tmp_path: Path) -> None:
        db = tmp_path / "t.sqlite"
        init_db(db)
        conn = get_connection(db)
        upsert_source_file(conn, "abc123", "path/a.pdf", "chase", "checking")
        mark_source_file_failed(conn, "abc123", "Parse error: no text", "2023-01-31T10:00:00")
        row = get_source_file(conn, "abc123")
        assert row is not None
        assert row["parse_status"] == "failed"
        assert row["parse_error"] == "Parse error: no text"

    def test_mark_enriched(self, tmp_path: Path) -> None:
        db = tmp_path / "t.sqlite"
        init_db(db)
        conn = get_connection(db)
        upsert_source_file(conn, "abc123", "path/a.pdf", "chase", "checking")
        mark_source_file_parsed(conn, "abc123", "2023-01-31T10:00:00")
        mark_source_file_enriched(conn, "abc123", 15, 3, 2, "2023-01-31T11:00:00")
        row = get_source_file(conn, "abc123")
        assert row is not None
        assert row["enrich_status"] == "enriched"
        assert row["enriched_transaction_count"] == 15
        assert row["unresolved_merchant_count"] == 3
        assert row["unresolved_category_count"] == 2

    def test_list_source_files_filter_by_status(self, tmp_path: Path) -> None:
        db = tmp_path / "t.sqlite"
        init_db(db)
        conn = get_connection(db)
        upsert_source_file(conn, "h1", "a.pdf", "chase", "checking")
        upsert_source_file(conn, "h2", "b.pdf", "chase", "checking")
        mark_source_file_parsed(conn, "h1", "2023-01-31T10:00:00")

        pending = list_source_files(conn, parse_status="pending")
        parsed = list_source_files(conn, parse_status="parsed")

        pending_hashes = {r["file_hash"] for r in pending}
        parsed_hashes = {r["file_hash"] for r in parsed}
        assert "h2" in pending_hashes
        assert "h1" in parsed_hashes

    def test_list_source_files_filter_by_institution(self, tmp_path: Path) -> None:
        db = tmp_path / "t.sqlite"
        init_db(db)
        conn = get_connection(db)
        upsert_source_file(conn, "h1", "a.pdf", "chase", "checking")
        upsert_source_file(conn, "h2", "b.pdf", "amex", "credit")

        chase_files = list_source_files(conn, institution="chase")
        amex_files = list_source_files(conn, institution="amex")

        chase_hashes = {r["file_hash"] for r in chase_files}
        amex_hashes = {r["file_hash"] for r in amex_files}
        assert "h1" in chase_hashes
        assert "h2" in amex_hashes
        assert "h1" not in amex_hashes
