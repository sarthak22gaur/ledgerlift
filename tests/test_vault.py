"""Tests for LEDGERLIFT_VAULT integration in store.py and CLI."""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest
import yaml


_SAMPLE_MERCHANTS_YAML = """\
rules:
  - id: test_merchant_a
    priority: 100
    match:
      type: contains
      pattern: coffeeshop
    canonical_merchant: CoffeeShop
    category: Food & Drink
    _source: user
  - id: test_merchant_base
    priority: 50
    match:
      type: contains
      pattern: somebase
    canonical_merchant: SomeBase
    _source: base
"""

_SAMPLE_CATEGORIES_YAML = """\
rules:
  - id: test_cat_a
    priority: 80
    when:
      merchant_normalized: CoffeeShop
    assign:
      category: Food & Drink
    _source: user
  - id: test_cat_base
    priority: 40
    when:
      description_regex: groceries
    assign:
      category: Groceries
    _source: base
"""

_SAMPLE_ACCOUNTS_YAML = """\
accounts:
  - last4: "0001"
    institution: vault_bank
    account_name: checking
  - last4: "0002"
    institution: vault_bank
    account_name: savings
"""

_SAMPLE_COUNTERPARTIES_YAML = """\
counterparties:
  - vault_transfer
  - vault_autopay
"""

_SAMPLE_MERCHANT_OVERRIDES_YAML = """\
overrides:
  - transaction_id: txn-override-1
    canonical_merchant: Override Merchant
    category: Shopping
"""

_SAMPLE_CATEGORY_OVERRIDES_YAML = """\
overrides:
  - transaction_id: txn-override-2
    category: Travel
"""


def _write_vault(vault: Path, **kwargs: str) -> None:
    for filename, content in kwargs.items():
        (vault / filename).write_text(content)


# ---------------------------------------------------------------------------
# resolve_db_path with LEDGERLIFT_VAULT
# ---------------------------------------------------------------------------


def test_vault_env_resolves_db_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import ledgerlift.store as store_module

    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setenv("LEDGERLIFT_VAULT", str(vault))
    monkeypatch.delenv("LEDGERLIFT_DB", raising=False)
    importlib.reload(store_module)

    try:
        resolved = store_module.resolve_db_path()
        assert resolved == vault / "ledgerlift.sqlite"
    finally:
        monkeypatch.delenv("LEDGERLIFT_VAULT", raising=False)
        importlib.reload(store_module)


def test_ledgerlift_db_overrides_vault(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import ledgerlift.store as store_module

    vault = tmp_path / "vault"
    vault.mkdir()
    explicit_db = tmp_path / "explicit.sqlite"
    monkeypatch.setenv("LEDGERLIFT_VAULT", str(vault))
    monkeypatch.setenv("LEDGERLIFT_DB", str(explicit_db))
    importlib.reload(store_module)

    try:
        resolved = store_module.resolve_db_path()
        assert resolved == explicit_db.resolve()
    finally:
        monkeypatch.delenv("LEDGERLIFT_VAULT", raising=False)
        monkeypatch.delenv("LEDGERLIFT_DB", raising=False)
        importlib.reload(store_module)



# ---------------------------------------------------------------------------
# Auto-import on init_db
# ---------------------------------------------------------------------------


def test_vault_yaml_import_on_init_db(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import ledgerlift.store as store_module

    vault = tmp_path / "vault"
    vault.mkdir()
    _write_vault(
        vault,
        **{
            "merchants.yaml": _SAMPLE_MERCHANTS_YAML,
            "categories.yaml": _SAMPLE_CATEGORIES_YAML,
            "accounts.yaml": _SAMPLE_ACCOUNTS_YAML,
            "internal_counterparties.yaml": _SAMPLE_COUNTERPARTIES_YAML,
        },
    )

    db_file = tmp_path / "test.sqlite"
    monkeypatch.setenv("LEDGERLIFT_VAULT", str(vault))
    monkeypatch.delenv("LEDGERLIFT_DB", raising=False)
    importlib.reload(store_module)

    try:
        store_module.init_db(db_file)
        conn = store_module.get_connection(db_file)

        mr_count = conn.execute(
            "SELECT COUNT(*) FROM merchant_rules WHERE source='user'"
        ).fetchone()[0]
        assert mr_count == 1, f"Expected 1 user merchant rule, got {mr_count}"

        cr_count = conn.execute(
            "SELECT COUNT(*) FROM category_rules WHERE source='user'"
        ).fetchone()[0]
        assert cr_count == 1, f"Expected 1 user category rule, got {cr_count}"

        acc_count = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
        assert acc_count == 2, f"Expected 2 accounts, got {acc_count}"

        ic_count = conn.execute("SELECT COUNT(*) FROM internal_counterparties WHERE name='vault_transfer'").fetchone()[0]
        assert ic_count == 1
    finally:
        monkeypatch.delenv("LEDGERLIFT_VAULT", raising=False)
        importlib.reload(store_module)


def test_vault_import_idempotent(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import ledgerlift.store as store_module

    vault = tmp_path / "vault"
    vault.mkdir()
    _write_vault(
        vault,
        **{
            "merchants.yaml": _SAMPLE_MERCHANTS_YAML,
            "accounts.yaml": _SAMPLE_ACCOUNTS_YAML,
        },
    )

    db_file = tmp_path / "test.sqlite"
    monkeypatch.setenv("LEDGERLIFT_VAULT", str(vault))
    monkeypatch.delenv("LEDGERLIFT_DB", raising=False)
    importlib.reload(store_module)

    try:
        store_module.init_db(db_file)
        store_module.init_db(db_file)

        conn = store_module.get_connection(db_file)
        mr_count = conn.execute(
            "SELECT COUNT(*) FROM merchant_rules WHERE source='user'"
        ).fetchone()[0]
        assert mr_count == 1, f"Expected 1 after two init_db calls, got {mr_count}"

        acc_count = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
        assert acc_count == 2, f"Expected 2 accounts after two init_db calls, got {acc_count}"
    finally:
        monkeypatch.delenv("LEDGERLIFT_VAULT", raising=False)
        importlib.reload(store_module)


def test_vault_import_skips_base_source_rows(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import ledgerlift.store as store_module

    vault = tmp_path / "vault"
    vault.mkdir()
    _write_vault(vault, **{"merchants.yaml": _SAMPLE_MERCHANTS_YAML})

    db_file = tmp_path / "test.sqlite"
    monkeypatch.setenv("LEDGERLIFT_VAULT", str(vault))
    monkeypatch.delenv("LEDGERLIFT_DB", raising=False)
    importlib.reload(store_module)

    try:
        store_module.init_db(db_file)
        conn = store_module.get_connection(db_file)
        user_only = conn.execute(
            "SELECT id FROM merchant_rules WHERE source='user'"
        ).fetchall()
        ids = [r[0] for r in user_only]
        assert "test_merchant_base" not in ids, "_source:base rows must not be imported as user"
        assert "test_merchant_a" in ids
    finally:
        monkeypatch.delenv("LEDGERLIFT_VAULT", raising=False)
        importlib.reload(store_module)


# ---------------------------------------------------------------------------
# Auto-export: _auto_export_vault
# ---------------------------------------------------------------------------


def test_auto_export_writes_vault_yamls(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import ledgerlift.store as store_module

    vault = tmp_path / "export_vault"
    vault.mkdir()
    db_file = tmp_path / "test.sqlite"

    monkeypatch.setenv("LEDGERLIFT_VAULT", str(vault))
    monkeypatch.delenv("LEDGERLIFT_DB", raising=False)
    importlib.reload(store_module)

    try:
        store_module.init_db(db_file)
        conn = store_module.get_connection(db_file)

        conn.execute(
            """
            INSERT INTO merchant_rules (id, priority, match_type, match_pattern, canonical_merchant, source)
            VALUES ('export_test', 100, 'contains', 'exporttest', 'ExportTest', 'user')
            """
        )
        conn.execute(
            "INSERT OR IGNORE INTO internal_counterparties(name) VALUES ('export_cp')"
        )
        conn.commit()

        store_module._auto_export_vault(conn)

        merchants_path = vault / "merchants.yaml"
        assert merchants_path.exists(), "merchants.yaml should be written by export"
        data = yaml.safe_load(merchants_path.read_text())
        ids = [r["id"] for r in data.get("rules", [])]
        assert "export_test" in ids

        ic_path = vault / "internal_counterparties.yaml"
        assert ic_path.exists()
        ic_data = yaml.safe_load(ic_path.read_text())
        assert "export_cp" in ic_data.get("counterparties", [])
    finally:
        monkeypatch.delenv("LEDGERLIFT_VAULT", raising=False)
        importlib.reload(store_module)


def test_auto_export_skipped_when_ledgerlift_db_set(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import ledgerlift.store as store_module

    vault = tmp_path / "vault"
    vault.mkdir()
    db_file = tmp_path / "test.sqlite"

    monkeypatch.setenv("LEDGERLIFT_VAULT", str(vault))
    monkeypatch.setenv("LEDGERLIFT_DB", str(db_file))
    importlib.reload(store_module)

    try:
        store_module.init_db(db_file)
        conn = store_module.get_connection(db_file)
        store_module._auto_export_vault(conn)
        assert not (vault / "merchants.yaml").exists(), "Export must be skipped when LEDGERLIFT_DB is set"
    finally:
        monkeypatch.delenv("LEDGERLIFT_VAULT", raising=False)
        monkeypatch.delenv("LEDGERLIFT_DB", raising=False)
        importlib.reload(store_module)


# ---------------------------------------------------------------------------
# CLI: rules import
# ---------------------------------------------------------------------------


def _clean_env(db_file: Path, vault: Path | None = None) -> dict[str, str | None]:
    env: dict[str, str | None] = {"LEDGERLIFT_DB": str(db_file), "LEDGERLIFT_VAULT": None}
    if vault is not None:
        env["LEDGERLIFT_VAULT"] = str(vault)
    return env


def test_rules_import_single_merchants_file(tmp_path: Path) -> None:
    from click.testing import CliRunner
    from ledgerlift.cli import cli
    import ledgerlift.store as store_module

    db_file = tmp_path / "test.sqlite"
    yaml_file = tmp_path / "merchants.yaml"
    yaml_file.write_text(_SAMPLE_MERCHANTS_YAML)

    runner = CliRunner()
    result = runner.invoke(cli, ["rules", "import", str(yaml_file)], env=_clean_env(db_file))
    assert result.exit_code == 0, result.output
    assert "1 merchant rules" in result.output

    conn = store_module.get_connection(db_file)
    count = conn.execute("SELECT COUNT(*) FROM merchant_rules WHERE source='user'").fetchone()[0]
    assert count == 1


def test_rules_import_all_from_dir(tmp_path: Path) -> None:
    from click.testing import CliRunner
    from ledgerlift.cli import cli
    import ledgerlift.store as store_module

    db_file = tmp_path / "test.sqlite"
    vault = tmp_path / "vault"
    vault.mkdir()
    _write_vault(
        vault,
        **{
            "merchants.yaml": _SAMPLE_MERCHANTS_YAML,
            "accounts.yaml": _SAMPLE_ACCOUNTS_YAML,
            "internal_counterparties.yaml": _SAMPLE_COUNTERPARTIES_YAML,
        },
    )

    runner = CliRunner()
    result = runner.invoke(
        cli,
        ["rules", "import", "--all", str(vault)],
        env=_clean_env(db_file),
    )
    assert result.exit_code == 0, result.output

    conn = store_module.get_connection(db_file)
    mr = conn.execute("SELECT COUNT(*) FROM merchant_rules WHERE source='user'").fetchone()[0]
    assert mr == 1
    acc = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    assert acc == 2


def test_rules_import_all_defaults_to_vault_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import ledgerlift.store as store_module

    vault = tmp_path / "vault"
    vault.mkdir()
    _write_vault(vault, **{"accounts.yaml": _SAMPLE_ACCOUNTS_YAML})

    db_file = tmp_path / "test.sqlite"
    monkeypatch.setenv("LEDGERLIFT_VAULT", str(vault))
    monkeypatch.setenv("LEDGERLIFT_DB", str(db_file))
    importlib.reload(store_module)

    try:
        from click.testing import CliRunner
        from ledgerlift.cli import cli

        runner = CliRunner()
        result = runner.invoke(
            cli,
            ["rules", "import", "--all"],
            env={"LEDGERLIFT_VAULT": str(vault), "LEDGERLIFT_DB": str(db_file)},
        )
        assert result.exit_code == 0, result.output
        conn = store_module.get_connection(db_file)
        acc = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
        assert acc >= 2
    finally:
        monkeypatch.delenv("LEDGERLIFT_VAULT", raising=False)
        monkeypatch.delenv("LEDGERLIFT_DB", raising=False)
        importlib.reload(store_module)


def test_rules_import_all_errors_without_dir_or_vault(tmp_path: Path) -> None:
    from click.testing import CliRunner
    from ledgerlift.cli import cli

    db_file = tmp_path / "test.sqlite"
    runner = CliRunner()
    result = runner.invoke(
        cli,
        ["rules", "import", "--all"],
        env={"LEDGERLIFT_DB": str(db_file), "LEDGERLIFT_VAULT": None},
    )
    assert result.exit_code != 0
    assert "LEDGERLIFT_VAULT" in result.output or "Specify" in result.output


def test_rules_import_missing_file_errors(tmp_path: Path) -> None:
    from click.testing import CliRunner
    from ledgerlift.cli import cli

    db_file = tmp_path / "test.sqlite"
    runner = CliRunner()
    result = runner.invoke(
        cli,
        ["rules", "import", str(tmp_path / "nonexistent.yaml")],
        env=_clean_env(db_file),
    )
    assert result.exit_code != 0


def test_duplicate_ids_preserved(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_file = tmp_path / "test.sqlite"
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "merchants.yaml").write_text(
        "rules:\n"
        "  - id: dup_id\n"
        "    priority: 100\n"
        "    match:\n"
        "      type: regex\n"
        "      pattern: first_pattern\n"
        "    canonical_merchant: FirstEntry\n"
        "  - id: dup_id\n"
        "    priority: 200\n"
        "    match:\n"
        "      type: contains\n"
        "      pattern: second_pattern\n"
        "    canonical_merchant: SecondEntry\n"
    )

    monkeypatch.setenv("LEDGERLIFT_DB", str(db_file))
    monkeypatch.setenv("LEDGERLIFT_VAULT", str(vault))
    import ledgerlift.store as store_module
    importlib.reload(store_module)
    store_module.init_db()

    conn = store_module.get_connection(db_file)
    rows = conn.execute(
        "SELECT rule_id, canonical_merchant, match_pattern FROM merchant_rules WHERE id='dup_id' AND source='user'"
    ).fetchall()
    conn.close()

    assert len(rows) == 2, f"Both dup_id rows must coexist; got {len(rows)}"
    merchants = {r["canonical_merchant"] for r in rows}
    assert merchants == {"FirstEntry", "SecondEntry"}
    rule_ids = {r["rule_id"] for r in rows}
    assert len(rule_ids) == 2, "Each row must have a distinct rule_id"


def test_duplicate_category_ids_preserved(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_file = tmp_path / "test.sqlite"
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "categories.yaml").write_text(
        "rules:\n"
        "  - id: dup_cat\n"
        "    priority: 50\n"
        "    when:\n"
        "      description_regex: first\n"
        "    assign:\n"
        "      category: FirstCategory\n"
        "  - id: dup_cat\n"
        "    priority: 99\n"
        "    when:\n"
        "      description_regex: second\n"
        "    assign:\n"
        "      category: SecondCategory\n"
    )

    monkeypatch.setenv("LEDGERLIFT_DB", str(db_file))
    monkeypatch.setenv("LEDGERLIFT_VAULT", str(vault))
    import ledgerlift.store as store_module
    importlib.reload(store_module)
    store_module.init_db()

    conn = store_module.get_connection(db_file)
    rows = conn.execute(
        "SELECT rule_id, assign_category, when_description_regex FROM category_rules WHERE id='dup_cat' AND source='user'"
    ).fetchall()
    conn.close()

    assert len(rows) == 2, f"Both dup_cat rows must coexist; got {len(rows)}"
    categories = {r["assign_category"] for r in rows}
    assert categories == {"FirstCategory", "SecondCategory"}
    rule_ids = {r["rule_id"] for r in rows}
    assert len(rule_ids) == 2, "Each row must have a distinct rule_id"
