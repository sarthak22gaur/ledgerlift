"""Regression checks for complete and atomic statement replacements."""

from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest
from click.testing import CliRunner

from ledgerlift import pipeline, store
from ledgerlift.models import Direction, ParsedStatement, RawTransaction, StatementMetadata
from ledgerlift.validation import check_parsed_statement


def statement(rows=None, *, version="1", ending="110", empty=False):
    if rows is None:
        rows = [RawTransaction(date_str="01/10", description="Example deposit", amount_str="10", direction=Direction.CREDIT)]
    return ParsedStatement(
        source_file_hash="placeholder", source_file_path="example.pdf",
        metadata=StatementMetadata(
            institution="chase", account_name="checking", account_type="checking",
            statement_start_date=date(2026, 1, 1), statement_end_date=date(2026, 1, 31),
            beginning_balance=Decimal("100"), ending_balance=Decimal(ending),
        ), raw_transactions=rows, extracted_text="Synthetic statement",
        parser_name="chase_checking_pdf", parser_version=version, empty_statement=empty,
    )


@pytest.fixture
def import_context(tmp_db, tmp_path, monkeypatch):
    _, conn = tmp_db
    raw = tmp_path / "raw"
    path = raw / "chase" / "checking" / "2026" / "example.pdf"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"synthetic pdf placeholder")
    monkeypatch.setattr(pipeline, "RAW_DIR", raw)
    monkeypatch.setattr(pipeline, "ensure_dirs", lambda: None)
    current = SimpleNamespace(result=statement(), version="1", name="chase_checking_pdf")

    def parse(path, file_hash):
        result = current.result.model_copy(deep=True)
        result.source_file_hash = file_hash
        result.source_file_path = str(path)
        return result

    current.parse = parse
    monkeypatch.setattr(pipeline, "get_parser", lambda *args: current)
    return conn, path, current


def test_parser_upgrade_repairs_and_preserves_identity(import_context):
    conn, path, parser = import_context
    assert pipeline.parse_all(conn)["parsed"] == 1
    old_id = conn.execute("SELECT transaction_id FROM transactions").fetchone()[0]
    conn.execute("INSERT INTO category_overrides (id, transaction_id, category) VALUES ('manual', ?, 'Example')", (old_id,))
    conn.commit()
    added = RawTransaction(date_str="01/05", description="Another deposit", amount_str="5", direction=Direction.CREDIT)
    parser.version = "2"
    parser.result = statement([added, *parser.result.raw_transactions], version="2", ending="115")
    assert pipeline.parse_all(conn)["parsed"] == 1
    ids = {r[0] for r in conn.execute("SELECT transaction_id FROM transactions")}
    assert old_id in ids and len(ids) == 2
    raw_count = conn.execute("SELECT count(*) FROM raw_transactions").fetchone()[0]
    assert pipeline.parse_all(conn)["skipped"] == 1
    assert {r[0] for r in conn.execute("SELECT transaction_id FROM transactions")} == ids
    assert conn.execute("SELECT count(*) FROM raw_transactions").fetchone()[0] == raw_count
    assert conn.execute("SELECT transaction_id FROM category_overrides WHERE id='manual'").fetchone()[0] == old_id


def test_failed_validation_preserves_prior_data_and_version(import_context):
    conn, path, parser = import_context
    assert pipeline.parse_file(conn, path, "chase", "checking")
    before = tuple(conn.execute("SELECT * FROM transactions").fetchone())
    parser.version = "2"
    parser.result = statement(version="2", ending="999")
    assert not pipeline.parse_file(conn, path, "chase", "checking")
    assert tuple(conn.execute("SELECT * FROM transactions").fetchone()) == before
    assert conn.execute("SELECT parser_version FROM statements").fetchone()[0] == "1"
    assert conn.execute("SELECT parse_status FROM source_files").fetchone()[0] == "failed"
    parser.result = statement(version="2")
    assert pipeline.parse_file(conn, path, "chase", "checking")


def test_ambiguous_override_blocks_replacement(import_context):
    conn, path, parser = import_context
    assert pipeline.parse_file(conn, path, "chase", "checking")
    old_id = conn.execute("SELECT transaction_id FROM transactions").fetchone()[0]
    conn.execute("INSERT INTO category_overrides (id, transaction_id, category) VALUES ('manual', ?, 'Example')", (old_id,))
    conn.commit()
    parser.version = "2"
    parser.result = statement([*parser.result.raw_transactions] * 2, version="2", ending="120")
    assert not pipeline.parse_file(conn, path, "chase", "checking")
    assert conn.execute("SELECT transaction_id FROM transactions").fetchone()[0] == old_id
    assert "override" in conn.execute("SELECT parse_error FROM source_files").fetchone()[0]


def test_normalization_loss_blocks_replacement(import_context):
    conn, path, parser = import_context
    parser.result.raw_transactions[0].date_str = "not a date"
    assert not pipeline.parse_file(conn, path, "chase", "checking")
    assert conn.execute("SELECT count(*) FROM transactions").fetchone()[0] == 0
    assert "Normalization dropped" in conn.execute("SELECT parse_error FROM source_files").fetchone()[0]


def test_storage_failure_rolls_back_all_replaced_rows(import_context):
    conn, path, parser = import_context
    assert pipeline.parse_file(conn, path, "chase", "checking")
    before = tuple(conn.execute("SELECT * FROM transactions").fetchone())
    conn.execute("CREATE TRIGGER reject_replacement BEFORE INSERT ON transactions BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END")
    conn.commit()
    parser.version = "2"
    parser.result = statement(version="2")
    assert not pipeline.parse_file(conn, path, "chase", "checking")
    assert tuple(conn.execute("SELECT * FROM transactions").fetchone()) == before
    assert conn.execute("SELECT count(*) FROM raw_transactions").fetchone()[0] == 1
    assert conn.execute("SELECT parser_version FROM statements").fetchone()[0] == "1"


def test_valid_empty_replacement_removes_prior_raw_rows(import_context):
    conn, path, parser = import_context
    assert pipeline.parse_file(conn, path, "chase", "checking")
    parser.version = "2"
    parser.result = statement([], version="2", ending="100", empty=True)
    assert pipeline.parse_file(conn, path, "chase", "checking")
    assert conn.execute("SELECT count(*) FROM raw_transactions").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM transactions").fetchone()[0] == 0


def test_extraction_errors_and_unexplained_empty_are_blocking():
    parsed = statement([], ending="100")
    assert check_parsed_statement(parsed).errors
    parsed.empty_statement = True
    assert not check_parsed_statement(parsed).errors
    parsed.extraction_errors.append("Unmatched activity row at line 12")
    assert check_parsed_statement(parsed).errors == ["Unmatched activity row at line 12"]


@pytest.mark.parametrize("command", [["parse"], ["run"], ["e2e"], ["e2e", "--force"]])
def test_cli_stops_before_export_on_failed_parse(import_context, monkeypatch, command):
    conn, path, parser = import_context
    monkeypatch.setenv("LEDGERLIFT_VAULT", "")
    import ledgerlift.cli as cli_module
    from ledgerlift.cli import cli
    import ledgerlift.intake as intake
    assert pipeline.parse_file(conn, path, "chase", "checking")
    old_id = conn.execute("SELECT transaction_id FROM transactions").fetchone()[0]
    parser.version = "2"
    parser.result = statement(version="2", ending="999")
    monkeypatch.setattr(cli_module, "init_db", lambda: Path("unused.sqlite"))
    monkeypatch.setattr(cli_module, "get_connection", lambda _: conn)
    monkeypatch.setattr(cli_module, "setup_logging", lambda *args: None)
    monkeypatch.setattr(cli_module, "ensure_dirs", lambda: None)
    monkeypatch.setattr(intake, "STATEMENTS_DIR", path.parent / "nonexistent")
    monkeypatch.setattr(pipeline, "export", lambda *args, **kwargs: pytest.fail("Exports must remain unchanged"))
    result = CliRunner().invoke(cli, command)
    assert result.exit_code != 0
    assert "exports were not updated" in result.output
    assert conn.execute("SELECT transaction_id FROM transactions").fetchone()[0] == old_id
