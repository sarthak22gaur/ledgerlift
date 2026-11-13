"""Persist transaction review decisions through parsing and enrichment."""

from datetime import date
from pathlib import Path
from types import SimpleNamespace

from ledgerlift import pipeline, store
from ledgerlift.models import Direction, ParsedStatement, RawTransaction, StatementMetadata


def test_review_confirmations_survive_enrichment_and_reparse(tmp_db, tmp_path, monkeypatch):
    _, conn = tmp_db
    raw = tmp_path / "raw"
    source = raw / "demo" / "credit" / "2025" / "statement.pdf"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"synthetic review statement")
    monkeypatch.setattr(pipeline, "RAW_DIR", raw)
    monkeypatch.setattr(pipeline, "ensure_dirs", lambda: None)

    def parse(path: Path, file_hash: str) -> ParsedStatement:
        return ParsedStatement(
            source_file_hash=file_hash,
            source_file_path=str(path),
            metadata=StatementMetadata(
                institution="demo", account_name="credit", account_type="credit",
                statement_start_date=date(2025, 1, 1),
                statement_end_date=date(2025, 1, 31),
            ),
            raw_transactions=[
                RawTransaction(date_str="01/05/2025", description="COSTCO EXAMPLE A", amount_str="-25.00", direction=Direction.DEBIT),
                RawTransaction(date_str="01/10/2025", description="COSTCO EXAMPLE B", amount_str="-400.00", direction=Direction.DEBIT),
                RawTransaction(date_str="01/15/2025", description="COSTCO EXAMPLE C", amount_str="-700.00", direction=Direction.DEBIT),
            ],
            extracted_text="Synthetic statement",
            parser_name="synthetic", parser_version="1",
        )

    monkeypatch.setattr(pipeline, "get_parser", lambda *_: SimpleNamespace(name="synthetic", version="1", parse=parse))
    conn.execute("DELETE FROM merchant_rules")
    conn.execute("DELETE FROM category_rules")
    conn.execute(
        "INSERT INTO merchant_rules(id, priority, match_type, match_pattern, canonical_merchant, category, source) "
        "VALUES('demo_retailer', 100, 'contains', 'costco', 'Costco', 'Groceries', 'user')"
    )
    conn.commit()
    assert pipeline.parse_file(conn, source, "demo", "credit")
    pipeline.enrich_all(conn, force=True)
    original = conn.execute("SELECT * FROM transactions ORDER BY transaction_date").fetchall()
    assert [r["category_normalized"] for r in original] == ["Groceries"] * 3
    decisions = [("Groceries", None), ("Shopping", "Furniture"), ("Shopping", "Technology")]

    for row, (category, subcategory) in zip(original, decisions):
        override_id = f"category-review:{row['transaction_id']}"
        # This is the record format written by the existing dashboard API.
        conn.execute(
            "INSERT INTO category_overrides(id, transaction_id, category, subcategory) VALUES(?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET category=excluded.category, subcategory=excluded.subcategory",
            (override_id, row["transaction_id"], category, subcategory),
        )
    conn.commit()
    store.set_meta(conn, "enrichment_dirty", "1")
    pipeline.enrich_all(conn, force=True)

    def assert_decisions():
        rows = conn.execute("SELECT * FROM transactions ORDER BY transaction_date").fetchall()
        assert [r["transaction_id"] for r in rows] == [r["transaction_id"] for r in original]
        assert [(r["category_normalized"], r["subcategory_normalized"]) for r in rows] == decisions
        assert [r["amount"] for r in rows] == [r["amount"] for r in original]
        for row in rows:
            assert row["category_rule_id"] == f"override:category-review:{row['transaction_id']}"
            assert row["category_confidence"] == 1.0
        assert store.get_meta(conn, "enrichment_dirty") == "0"

    assert_decisions()
    assert pipeline.parse_file(conn, source, "demo", "credit", force=True)
    pipeline.enrich_all(conn)
    assert_decisions()
    assert conn.execute("SELECT COUNT(*) FROM category_overrides").fetchone()[0] == 3
