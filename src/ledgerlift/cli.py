"""CLI entrypoint for LedgerLift."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

import click
from dotenv import load_dotenv

load_dotenv()  # Load .env from project root

from ledgerlift import __version__
from ledgerlift.config import LOG_DATE_FORMAT, LOG_FORMAT, LOGS_DIR, ensure_dirs
from ledgerlift.store import get_connection, init_db, reset_derived_state


def setup_logging(verbose: bool = False, quiet: bool = False) -> None:
    """Configure logging to both console and file."""
    ensure_dirs()
    if verbose:
        level = logging.DEBUG
    elif quiet:
        level = logging.WARNING
    else:
        level = logging.INFO

    root_logger = logging.getLogger("ledgerlift")
    root_logger.setLevel(logging.DEBUG)

    console = logging.StreamHandler(sys.stderr)
    console.setLevel(level)
    console.setFormatter(logging.Formatter(LOG_FORMAT, LOG_DATE_FORMAT))
    root_logger.addHandler(console)

    log_file = LOGS_DIR / "ledgerlift.log"
    file_handler = logging.FileHandler(log_file)
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter(LOG_FORMAT, LOG_DATE_FORMAT))
    root_logger.addHandler(file_handler)


@click.group()
@click.version_option(version=__version__)
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose logging")
@click.option("-q", "--quiet", is_flag=True, help="Only show warnings and errors")
def cli(verbose: bool, quiet: bool) -> None:
    """LedgerLift: Parse personal financial statements into a canonical ledger."""
    setup_logging(verbose, quiet)



@cli.group()
def rules() -> None:
    """Manage enrichment rules stored in the SQLite database."""
    pass


@rules.command("export-yaml")
@click.option(
    "--out",
    type=click.Path(file_okay=False, dir_okay=True, path_type=Path),
    default=None,
    help="Output directory. Defaults to data/rules/export/.",
)
def rules_export_yaml(out: Path | None) -> None:
    """Export rules from SQLite back to YAML files (for version control / backup).

    Writes: merchants.yaml, categories.yaml, merchant_overrides.yaml,
    category_overrides.yaml, accounts.yaml, internal_counterparties.yaml.

    Base rules are included with a comment noting they are auto-seeded.
    """
    import yaml
    from ledgerlift.config import EXPORTS_DIR
    from ledgerlift.store import (
        list_category_overrides,
        list_category_rules,
        list_internal_counterparties,
        list_merchant_overrides,
        list_merchant_rules,
    )

    db_path = init_db()
    conn = get_connection(db_path)

    if out is None:
        out = EXPORTS_DIR / "rules-export"
    out.mkdir(parents=True, exist_ok=True)

    raw_mr = list_merchant_rules(conn)
    mr_data = {
        "rules": [
            {
                "id": r["id"],
                "priority": r["priority"],
                "match": {"type": r["match"]["type"], "pattern": r["match"]["pattern"]},
                "canonical_merchant": r["canonical_merchant"],
                **({"category": r["category"]} if r["category"] else {}),
                **({"subcategory": r["subcategory"]} if r["subcategory"] else {}),
                "_source": r.get("source", "user"),
            }
            for r in raw_mr
        ]
    }
    (out / "merchants.yaml").write_text(
        "# Exported from LedgerLift SQLite store.\n"
        "# Rows with _source: base are auto-seeded and do not need to be checked in.\n"
        + yaml.dump(mr_data, allow_unicode=True, sort_keys=False)
    )

    raw_cr = list_category_rules(conn)
    cr_data = {
        "rules": [
            {
                "id": r["id"],
                "priority": r["priority"],
                "when": {k: v for k, v in r["when"].items() if v is not None},
                "assign": {k: v for k, v in r["assign"].items() if v is not None},
                "_source": r.get("source", "user"),
            }
            for r in raw_cr
        ]
    }
    (out / "categories.yaml").write_text(
        "# Exported from LedgerLift SQLite store.\n"
        "# Rows with _source: base are auto-seeded and do not need to be checked in.\n"
        + yaml.dump(cr_data, allow_unicode=True, sort_keys=False)
    )

    raw_mo = list_merchant_overrides(conn)
    mo_data = {"overrides": raw_mo}
    (out / "merchant_overrides.yaml").write_text(
        yaml.dump(mo_data, allow_unicode=True, sort_keys=False)
    )

    raw_co = list_category_overrides(conn)
    co_data = {"overrides": raw_co}
    (out / "category_overrides.yaml").write_text(
        yaml.dump(co_data, allow_unicode=True, sort_keys=False)
    )

    db_conn_for_accounts = conn
    acc_rows = db_conn_for_accounts.execute("SELECT * FROM accounts").fetchall()
    acc_data = {
        "accounts": [
            {k: v for k, v in dict(row).items() if v is not None}
            for row in acc_rows
        ]
    }
    (out / "accounts.yaml").write_text(
        yaml.dump(acc_data, allow_unicode=True, sort_keys=False)
    )

    names = list_internal_counterparties(conn)
    ic_data = {"counterparties": names}
    (out / "internal_counterparties.yaml").write_text(
        yaml.dump(ic_data, allow_unicode=True, sort_keys=False)
    )

    click.echo(f"Rules exported to {out}/")
    click.echo(f"  merchants.yaml          ({len(raw_mr)} rules)")
    click.echo(f"  categories.yaml         ({len(raw_cr)} rules)")
    click.echo(f"  merchant_overrides.yaml ({len(raw_mo)} overrides)")
    click.echo(f"  category_overrides.yaml ({len(raw_co)} overrides)")
    click.echo(f"  accounts.yaml           ({len(acc_rows)} accounts)")
    click.echo(f"  internal_counterparties.yaml ({len(names)} counterparties)")


@rules.command("import")
@click.argument(
    "path",
    default=None,
    required=False,
    type=click.Path(path_type=Path),
)
@click.option(
    "--all",
    "import_all",
    is_flag=True,
    help="Import all standard YAMLs from PATH (treated as a directory).",
)
def rules_import(path: Path | None, import_all: bool) -> None:
    """Import rules from a YAML file or directory into SQLite.

    ledgerlift rules import                 -- bulk import from $LEDGERLIFT_VAULT
    ledgerlift rules import DIR             -- bulk import from directory
    ledgerlift rules import FILE.yaml       -- import a single YAML
    """
    from ledgerlift.store import (
        _import_accounts_yaml_from_path,
        _import_categories_yaml,
        _import_category_overrides_yaml,
        _import_counterparties_yaml,
        _import_merchant_overrides_yaml,
        _import_merchants_yaml,
        vault_dir,
    )

    db_path = init_db()
    conn = get_connection(db_path)

    target_dir: Path | None = None
    if import_all:
        target_dir = path or vault_dir()
    elif path is None:
        target_dir = vault_dir()
    elif path.is_dir():
        target_dir = path

    if target_dir is not None:
        target_dir = target_dir.expanduser().resolve()
        if not target_dir.exists():
            raise click.ClickException(f"Directory not found: {target_dir}")

        _USER_RULE_WIPE = {
            "merchants.yaml": "DELETE FROM merchant_rules WHERE source='user'",
            "categories.yaml": "DELETE FROM category_rules WHERE source='user'",
            "merchant_overrides.yaml": "DELETE FROM merchant_overrides",
            "category_overrides.yaml": "DELETE FROM category_overrides",
            "accounts.yaml": "DELETE FROM accounts",
            "internal_counterparties.yaml": "DELETE FROM internal_counterparties",
        }
        _YAML_IMPORTERS = {
            "merchants.yaml": _import_merchants_yaml,
            "categories.yaml": _import_categories_yaml,
            "merchant_overrides.yaml": _import_merchant_overrides_yaml,
            "category_overrides.yaml": _import_category_overrides_yaml,
            "accounts.yaml": _import_accounts_yaml_from_path,
            "internal_counterparties.yaml": _import_counterparties_yaml,
        }
        for filename, importer in _YAML_IMPORTERS.items():
            file_path = target_dir / filename
            if not file_path.exists():
                click.echo(f"  SKIP {filename} (not found)")
                continue
            conn.execute(_USER_RULE_WIPE[filename])
            conn.commit()
            count = importer(conn, file_path)
            click.echo(f"  {filename}: {count} entries imported")
        return

    if path is None:
        raise click.ClickException("Set LEDGERLIFT_VAULT or pass a file/dir path.")

    single_path = path.expanduser().resolve()
    if not single_path.exists():
        raise click.ClickException(f"File not found: {single_path}")
    path = single_path

    try:
        import yaml as _yaml
        with open(path) as fh:
            data = _yaml.safe_load(fh)
    except Exception as exc:
        raise click.ClickException(f"Failed to read {path}: {exc}") from exc

    if data is None:
        raise click.ClickException(f"Empty or unparseable file: {path}")

    if "rules" in data:
        if any("canonical_merchant" in str(r) for r in data.get("rules", [])):
            count = _import_merchants_yaml(conn, path)
            click.echo(f"Imported {count} merchant rules from {path.name}")
        else:
            count = _import_categories_yaml(conn, path)
            click.echo(f"Imported {count} category rules from {path.name}")
    elif "overrides" in data:
        sample = data["overrides"][0] if data["overrides"] else {}
        if "canonical_merchant" in sample or ("category" in sample and "canonical_merchant" not in sample and len(sample) <= 3):
            count = _import_merchant_overrides_yaml(conn, path)
            click.echo(f"Imported {count} merchant overrides from {path.name}")
        else:
            count = _import_category_overrides_yaml(conn, path)
            click.echo(f"Imported {count} category overrides from {path.name}")
    elif "accounts" in data:
        count = _import_accounts_yaml_from_path(conn, path)
        click.echo(f"Imported {count} accounts from {path.name}")
    elif "counterparties" in data:
        count = _import_counterparties_yaml(conn, path)
        click.echo(f"Imported {count} counterparties from {path.name}")
    else:
        raise click.ClickException(
            f"Cannot detect kind from {path.name}. Expected top-level key: "
            "rules, overrides, accounts, or counterparties."
        )


@cli.group()
def accounts() -> None:
    """Manage account mappings stored in the SQLite database."""
    pass


@accounts.command("import")
@click.argument(
    "path",
    default=None,
    required=False,
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
)
def accounts_import(path: Path | None) -> None:
    """Import account mappings from a YAML file into the SQLite accounts table.

    Reads a YAML file with a top-level `accounts:` list. Each entry should
    have institution and account fields, and optionally last4, opened_date,
    and closed_date. Uses INSERT OR IGNORE so existing rows are not overwritten.

    PATH defaults to data/rules/accounts.yaml.
    """
    import yaml
    from ledgerlift.config import RULES_DIR

    if path is None:
        path = RULES_DIR / "accounts.yaml"
        if not path.exists():
            raise click.ClickException(
                f"Default accounts file not found: {path}\n"
                "Pass an explicit PATH or create data/rules/accounts.yaml first."
            )

    try:
        with open(path) as f:
            data = yaml.safe_load(f)
    except Exception as exc:
        raise click.ClickException(f"Failed to read {path}: {exc}") from exc

    if not data or "accounts" not in data:
        raise click.ClickException(f"No 'accounts:' key found in {path}")

    entries: list[dict] = list(data["accounts"])
    if not entries:
        click.echo("No entries found in the YAML file.")
        return

    db_path = init_db()
    conn = get_connection(db_path)

    rows = []
    for entry in entries:
        rows.append((
            str(entry["last4"]) if entry.get("last4") is not None else None,
            entry.get("institution", ""),
            entry.get("account_name") or entry.get("account", ""),
            str(entry["opened_date"]) if entry.get("opened_date") is not None else None,
            str(entry["closed_date"]) if entry.get("closed_date") is not None else None,
        ))

    before = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    conn.executemany(
        """
        INSERT OR IGNORE INTO accounts (last4, institution, account_name, opened_date, closed_date)
        VALUES (?, ?, ?, ?, ?)
        """,
        rows,
    )
    conn.commit()
    after = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]

    imported = after - before
    skipped = len(rows) - imported
    click.echo(f"Imported {imported} account(s), skipped {skipped} (already present).")


@cli.command()
@click.option("--institution", "-i", default=None, help="Filter by institution")
@click.option("--account", "-a", default=None, help="Filter by account name")
@click.option("--year", "-y", type=int, default=None, help="Filter by year")
def scan(institution: str | None, account: str | None, year: int | None) -> None:
    """Discover and register source statement PDFs."""
    from ledgerlift.pipeline import scan as do_scan

    db_path = init_db()
    conn = get_connection(db_path)
    counts = do_scan(conn, institution, account, year)

    click.echo("Scan complete:")
    click.echo(f"  Total files found: {counts['total']}")
    click.echo(f"  New files:         {counts['new']}")
    click.echo(f"  Already known:     {counts['existing']}")


@cli.command()
@click.option("--institution", "-i", default=None, help="Filter by institution")
@click.option("--account", "-a", default=None, help="Filter by account name")
@click.option("--year", "-y", type=int, default=None, help="Filter by year")
@click.option("--force", "-f", is_flag=True, help="Force reparse of already parsed files")
def parse(
    institution: str | None, account: str | None, year: int | None, force: bool
) -> None:
    """Parse source statements into structured data."""
    from ledgerlift.pipeline import parse_all, scan as do_scan

    db_path = init_db()
    conn = get_connection(db_path)
    do_scan(conn, institution, account, year)
    counts = parse_all(conn, institution, account, year, force=force)

    click.echo("Parse complete:")
    click.echo(f"  Total files:  {counts['total']}")
    click.echo(f"  Parsed:       {counts['parsed']}")
    click.echo(f"  Skipped:      {counts['skipped']}")
    click.echo(f"  Failed:       {counts['failed']}")


@cli.command(name="export")
@click.option(
    "--net",
    is_flag=True,
    help="Also export net versions excluding both sides of all matched transfer pairs",
)
def export_cmd(net: bool) -> None:
    """Export canonical transactions to CSV and JSON."""
    from ledgerlift.pipeline import export as do_export

    db_path = init_db()
    conn = get_connection(db_path)
    counts = do_export(conn, net=net)

    click.echo("Export complete:")
    click.echo(f"  Transactions:     {counts['exported']}")
    click.echo(f"  Deduplicated:     {counts['deduplicated']}")
    if net and "net_exported" in counts:
        click.echo(f"  Net transactions: {counts['net_exported']}")
        click.echo(f"  Transfers elim:   {counts['transfers_eliminated']}")


@cli.command()
def status() -> None:
    """Show processing status summary."""
    from ledgerlift.store import list_source_files

    db_path = init_db()
    conn = get_connection(db_path)

    all_files = list_source_files(conn)
    total = len(all_files)
    counts: dict[str, int] = {}
    for sf in all_files:
        s = sf["parse_status"]
        counts[s] = counts.get(s, 0) + 1

    click.echo("LedgerLift Status")
    click.echo("=" * 40)
    click.echo(f"Total source files:  {total}")
    click.echo()
    click.echo("By status:")
    for s in ["pending", "parsed", "failed"]:
        click.echo(f"  {s:12s} {counts.get(s, 0)}")


@cli.command()
@click.argument("what", type=click.Choice(["merchants", "categories"]), default="merchants")
@click.option("--limit", "-n", type=int, default=30, help="Max items to show")
def unresolved(what: str, limit: int) -> None:
    """Show unresolved merchants or categories to help build rules."""
    import csv as csv_mod
    from collections import Counter
    from ledgerlift.config import EXPORTS_DIR
    from ledgerlift.store import list_transactions

    db_path = init_db()
    conn = get_connection(db_path)

    rows = list_transactions(conn)
    unresolved_items = []
    for row in rows:
        if what == "merchants" and not row["merchant_rule_id"]:
            unresolved_items.append(dict(row))
        elif what == "categories" and (
            not row["category_rule_id"] or row["category_normalized"] == "Uncategorized"
        ):
            unresolved_items.append(dict(row))

    if not unresolved_items:
        click.echo(f"No unresolved {what} found.")
        return

    if what == "merchants":
        key_fn = lambda t: t.get("merchant_normalized") or t.get("description_normalized", "")
    else:
        key_fn = lambda t: t.get("description_normalized", "")

    freq = Counter(key_fn(t) for t in unresolved_items)
    spend: Counter = Counter()
    for t in unresolved_items:
        key = key_fn(t)
        try:
            spend[key] += abs(float(t.get("amount", 0)))
        except (ValueError, TypeError):
            pass

    click.echo(f"\nTop {limit} unresolved {what} (by frequency):\n")
    click.echo(f"{'Count':>6}  {'Spend':>10}  Description")
    click.echo(f"{'─' * 6}  {'─' * 10}  {'─' * 50}")

    for desc, count in freq.most_common(limit):
        total_spend = spend.get(desc, 0)
        click.echo(f"{count:>6}  ${total_spend:>9,.2f}  {desc[:60]}")

    click.echo(f"\nTotal unresolved: {len(unresolved_items)} transactions")

    report_path = EXPORTS_DIR / f"unresolved_{what}.csv"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w", newline="") as f:
        writer = csv_mod.writer(f)
        writer.writerow(["description", "count", "total_spend"])
        for desc, count in freq.most_common():
            writer.writerow([desc, count, f"{spend.get(desc, 0):.2f}"])
    click.echo(f"\nFull report: {report_path}")


@cli.command()
def transfers() -> None:
    """Show matched transfer pairs across accounts."""
    from ledgerlift.enrich.transfers import match_transfer_pairs
    from ledgerlift.exporters import deduplicate_transactions
    from ledgerlift.pipeline import _row_to_txn
    from ledgerlift.store import list_transactions

    db_path = init_db()
    conn = get_connection(db_path)

    rows = list_transactions(conn)
    all_txns = [_row_to_txn(row) for row in rows]
    all_txns = deduplicate_transactions(all_txns)
    all_txns = match_transfer_pairs(all_txns)

    from collections import defaultdict
    pairs: dict[str, list] = defaultdict(list)
    for txn in all_txns:
        if txn.transfer_pair_id:
            pairs[txn.transfer_pair_id].append(txn)

    if not pairs:
        click.echo("No transfer pairs found.")
        return

    click.echo()
    click.echo(
        f"{'Pair ID':<14} {'Date1':<12} {'Date2':<12} {'Amount':>12} "
        f"{'Account1':<25} {'Account2':<25} {'Confidence':>10}"
    )
    click.echo("-" * 112)

    for pair_id, pair_txns in sorted(pairs.items()):
        if len(pair_txns) != 2:
            continue
        t1, t2 = sorted(pair_txns, key=lambda t: t.transaction_date)
        acct1 = f"{t1.institution}/{t1.account_name}"
        acct2 = f"{t2.institution}/{t2.account_name}"
        click.echo(
            f"{pair_id:<14} {t1.transaction_date!s:<12} {t2.transaction_date!s:<12} "
            f"${abs(t1.amount):>11,.2f} {acct1:<25} {acct2:<25} "
            f"{t1.transfer_match_confidence or 0:>10.1f}"
        )

    click.echo(f"\nTotal: {len(pairs)} transfer pairs")


@cli.command()
def reconcile() -> None:
    """Show balance reconciliation for all parsed statements."""
    from ledgerlift.models import ParsedStatement, RawTransaction, StatementMetadata, Direction
    from ledgerlift.reconciliation import reconcile_statement

    db_path = init_db()
    conn = get_connection(db_path)

    stmt_rows = conn.execute("SELECT * FROM statements").fetchall()
    results = []

    for stmt_row in stmt_rows:
        stmt_id = stmt_row["id"]
        raw_rows = conn.execute(
            "SELECT * FROM raw_transactions WHERE statement_id = ?", (stmt_id,)
        ).fetchall()

        # Build a minimal ParsedStatement for reconciliation
        from datetime import date as _date

        def _d(v):
            return _date.fromisoformat(v) if v else None

        from decimal import Decimal
        meta = StatementMetadata(
            institution=stmt_row["institution"],
            account_name=stmt_row["account_name"],
            account_type=stmt_row["account_type"],
            statement_start_date=_d(stmt_row["statement_start_date"]),
            statement_end_date=_d(stmt_row["statement_end_date"]),
            beginning_balance=Decimal(str(stmt_row["beginning_balance"])) if stmt_row["beginning_balance"] is not None else None,
            ending_balance=Decimal(str(stmt_row["ending_balance"])) if stmt_row["ending_balance"] is not None else None,
        )

        raw_txns = []
        for rt in raw_rows:
            direction = None
            if rt["direction"]:
                try:
                    direction = Direction(rt["direction"])
                except ValueError:
                    pass
            raw_txns.append(RawTransaction(
                date_str=rt["transaction_date"] or "",
                description=rt["description"] or "",
                amount_str=str(rt["amount"]) if rt["amount"] is not None else "0",
                direction=direction,
                reference_number=rt["reference_number"],
            ))

        parsed = ParsedStatement(
            source_file_hash=stmt_row["source_file_hash"],
            source_file_path=stmt_row["source_file_hash"],
            metadata=meta,
            raw_transactions=raw_txns,
            extracted_text="",
            parser_name=stmt_row["parser_name"],
            parser_version=stmt_row["parser_version"],
        )
        result = reconcile_statement(parsed)
        if result is not None:
            results.append(result)

    if not results:
        click.echo("No statements with balance data found.")
        return

    click.echo()
    click.echo(
        f"{'Account':<25} {'Period':<25} {'Begin':>12} {'End':>12} {'Expected':>12} {'Diff':>10} {'Status':>8}"
    )
    click.echo("-" * 107)

    ok_count = 0
    fail_count = 0
    for r in sorted(results, key=lambda x: (x.institution, x.account_name, x.statement_period)):
        label = f"{r.institution}/{r.account_name}"
        status = "OK" if r.is_reconciled else "FAIL"
        if r.is_reconciled:
            ok_count += 1
        else:
            fail_count += 1
        click.echo(
            f"{label:<25} {r.statement_period:<25} "
            f"{r.beginning_balance:>12,.2f} {r.ending_balance:>12,.2f} "
            f"{r.expected_ending:>12,.2f} {r.discrepancy:>10,.2f} {status:>8}"
        )

    click.echo()
    click.echo(f"Total: {len(results)} statements — {ok_count} OK, {fail_count} FAIL")


@cli.command()
@click.option("--dry-run", "-n", is_flag=True, help="Show what would be copied without copying")
@click.option("--no-interactive", is_flag=True, help="Skip unrecognized files instead of prompting")
def intake(dry_run: bool, no_interactive: bool) -> None:
    """Copy statements from data/statements/ into the correct raw directory structure."""
    from ledgerlift.intake import STATEMENTS_DIR, run_intake

    init_db()

    if not STATEMENTS_DIR.exists():
        click.echo(f"No statements directory found at {STATEMENTS_DIR}")
        click.echo("Create it and drop your files there.")
        return

    results = run_intake(dry_run=dry_run, interactive=not no_interactive)

    if not results:
        click.echo("No files found in data/statements/")
        return

    copied = [r for r in results if r.copied]
    skipped = [r for r in results if not r.copied]

    prefix = "[DRY RUN] " if dry_run else ""

    for r in copied:
        rel = Path(r.institution) / r.account / str(r.year) / r.source.name
        click.echo(f"  {prefix}{r.source.name} -> raw/{rel}")

    for r in skipped:
        click.echo(f"  SKIP {r.source.name}: {r.reason}")

    click.echo()
    click.echo(f"{prefix}Copied: {len(copied)}, Skipped: {len(skipped)}")


@cli.command()
def coverage() -> None:
    """Show statement coverage and missing months for each account."""
    from ledgerlift.coverage import analyze_coverage, format_month

    results = analyze_coverage()

    if not results:
        click.echo("No processed statements found. Run `ledgerlift parse` first.")
        return

    all_complete = True
    for cov in results:
        total_expected = len(cov.covered_months) + len(cov.missing_months)
        covered_count = len(cov.covered_months)
        label = f"{cov.institution}/{cov.account_name}"

        status_tag = ""
        if cov.closed_date is not None:
            status_tag = f"  [closed {cov.closed_date}]"

        click.echo(f"\n{label}{status_tag}")
        click.echo(f"  Statements:  {cov.statement_count}")
        click.echo(f"  Range:       {cov.first_date} to {cov.last_date}")
        click.echo(f"  Coverage:    {covered_count}/{total_expected} months")

        if cov.missing_months:
            all_complete = False
            ranges = _group_consecutive_months(cov.missing_months)
            click.echo(f"  Missing:     {', '.join(ranges)}")
        else:
            click.echo("  Missing:     none")

    click.echo()
    if all_complete:
        click.echo("All accounts have complete coverage.")
    else:
        click.echo("Some accounts have gaps. Add the missing statements and re-run the pipeline.")


def _group_consecutive_months(months: list[tuple[int, int]]) -> list[str]:
    """Group consecutive (year, month) tuples into 'YYYY-MM to YYYY-MM' ranges."""
    from ledgerlift.coverage import format_month

    if not months:
        return []

    ranges: list[str] = []
    start = months[0]
    prev = months[0]

    for ym in months[1:]:
        py, pm = prev
        expected_next = (py, pm + 1) if pm < 12 else (py + 1, 1)
        if ym == expected_next:
            prev = ym
        else:
            if start == prev:
                ranges.append(format_month(*start))
            else:
                ranges.append(f"{format_month(*start)} to {format_month(*prev)}")
            start = ym
            prev = ym

    if start == prev:
        ranges.append(format_month(*start))
    else:
        ranges.append(f"{format_month(*start)} to {format_month(*prev)}")

    return ranges


@cli.command()
@click.option("--institution", "-i", default=None)
@click.option("--account", "-a", default=None)
@click.option("--force", "-f", is_flag=True)
@click.option("--no-fuzzy", is_flag=True)
def enrich(institution: str | None, account: str | None, force: bool, no_fuzzy: bool) -> None:
    """Apply merchant and category rules to parsed transactions."""
    from ledgerlift.pipeline import enrich_all

    db_path = init_db()
    conn = get_connection(db_path)
    counts = enrich_all(conn, institution, account, force=force, enable_fuzzy=not no_fuzzy)

    click.echo("Enrichment complete:")
    click.echo(f"  Files processed:       {counts['files']} ({counts['skipped']} skipped)")
    click.echo(f"  Transactions:          {counts['total']}")
    click.echo(f"  Resolved merchants:    {counts['resolved_merchants']}")
    click.echo(f"  Unresolved merchants:  {counts['unresolved_merchants']}")
    click.echo(f"  Resolved categories:   {counts['resolved_categories']}")
    click.echo(f"  Unresolved categories: {counts['unresolved_categories']}")


@cli.command()
@click.option(
    "--out",
    type=click.Path(file_okay=True, dir_okay=True, path_type=Path),
    default=None,
)
def backup_zip_cmd(out: Path | None) -> None:
    """Zip data/raw/ with a date-stamped filename for manual cloud upload."""
    import zipfile
    from datetime import date
    from ledgerlift.config import RAW_DIR

    if not RAW_DIR.exists():
        raise click.ClickException(f"Nothing to back up: {RAW_DIR} does not exist")

    stamp = date.today().isoformat()
    default_name = f"ledgerlift-raw-{stamp}.zip"

    if out is None:
        out = Path.home() / "Desktop" / default_name
    elif out.is_dir() or (not out.exists() and out.suffix == ""):
        out = out / default_name

    out = out.expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    files = [p for p in RAW_DIR.rglob("*") if p.is_file()]
    if not files:
        raise click.ClickException(f"No files under {RAW_DIR}")

    click.echo(f"Zipping {len(files)} files from {RAW_DIR}")
    click.echo(f"  -> {out}")

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for f in files:
            arcname = f.relative_to(RAW_DIR.parent)
            zf.write(f, arcname)

    size_mb = out.stat().st_size / (1024 * 1024)
    click.echo(f"Done: {size_mb:,.1f} MB")


@cli.command()
def run() -> None:
    """Run the full pipeline: scan -> parse -> enrich -> transfers -> export."""
    from ledgerlift.pipeline import (
        enrich_all,
        export as do_export,
        parse_all,
        run_transfer_matching,
        scan as do_scan,
    )

    db_path = init_db()
    conn = get_connection(db_path)

    click.echo("Scanning...")
    scan_counts = do_scan(conn)
    click.echo(f"  Found {scan_counts['total']} files ({scan_counts['new']} new)")

    click.echo("Parsing...")
    parse_counts = parse_all(conn)
    click.echo(
        f"  Parsed {parse_counts['parsed']}, "
        f"skipped {parse_counts['skipped']}, "
        f"failed {parse_counts['failed']}"
    )

    click.echo("Enriching...")
    enrich_counts = enrich_all(conn)
    click.echo(
        f"  Resolved {enrich_counts['resolved_merchants']}/{enrich_counts['total']} merchants, "
        f"{enrich_counts['resolved_categories']}/{enrich_counts['total']} categories"
    )

    click.echo("Matching transfers...")
    transfer_counts = run_transfer_matching(conn)
    click.echo(f"  {transfer_counts['pairs']} transfer pairs matched")

    click.echo("Exporting...")
    export_counts = do_export(conn)
    click.echo(f"  Exported {export_counts['exported']} transactions")

    click.echo("Done.")


@cli.command()
@click.option(
    "--force",
    "-f",
    is_flag=True,
    help="Force a clean reparse and re-enrichment of every file.",
)
def e2e(force: bool) -> None:
    """Run the full end-to-end pipeline: intake -> scan -> parse -> enrich -> transfers -> export."""
    from ledgerlift.intake import STATEMENTS_DIR, run_intake
    from ledgerlift.pipeline import (
        enrich_all,
        export as do_export,
        parse_all,
        run_transfer_matching,
        scan as do_scan,
    )

    db_path = init_db()
    conn = get_connection(db_path)

    if force:
        click.echo("Force rebuild: clearing all derived state...")
        reset_derived_state(conn)

    click.echo("Intake...")
    if STATEMENTS_DIR.exists():
        results = run_intake(interactive=False)
        copied = sum(1 for r in results if r.copied)
        skipped = sum(1 for r in results if not r.copied)
        click.echo(f"  Copied {copied}, skipped {skipped}")
    else:
        click.echo("  No statements directory, skipping")

    click.echo("Scanning...")
    scan_counts = do_scan(conn)
    click.echo(f"  Found {scan_counts['total']} files ({scan_counts['new']} new)")

    if scan_counts["total"] == 0:
        click.echo("No source files found. Add PDFs/CSVs to data/raw/ and re-run.")
        return

    click.echo("Parsing..." + (" (force)" if force else ""))
    parse_counts = parse_all(conn, force=force)
    click.echo(
        f"  Parsed {parse_counts['parsed']}, "
        f"skipped {parse_counts['skipped']}, "
        f"failed {parse_counts['failed']}"
    )

    click.echo("Enriching..." + (" (force)" if force else ""))
    enrich_counts = enrich_all(conn, force=force)
    click.echo(
        f"  Resolved {enrich_counts['resolved_merchants']}/{enrich_counts['total']} merchants, "
        f"{enrich_counts['resolved_categories']}/{enrich_counts['total']} categories"
    )

    click.echo("Matching transfers...")
    transfer_counts = run_transfer_matching(conn)
    click.echo(f"  {transfer_counts['pairs']} transfer pairs matched")

    click.echo("Exporting...")
    export_counts = do_export(conn)
    click.echo(f"  Exported {export_counts['exported']} transactions")

    click.echo("Done.")
