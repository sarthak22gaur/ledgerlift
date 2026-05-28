"""Intake utility: copy statement files into the correct directory structure.

Tries to parse known filename patterns automatically. For CSVs like Amex,
inspects file content to identify the institution. For unrecognized files,
prompts the user for institution, account, and year.

Files are COPIED (not moved) so the drop folder keeps an unsorted archive.
"""

from __future__ import annotations

import csv
import logging
import re
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from ledgerlift.config import DATA_DIR, RAW_DIR, SUPPORTED_SOURCES

logger = logging.getLogger(__name__)

STATEMENTS_DIR = DATA_DIR / "statements"


def _load_account_map() -> dict[str, tuple[str, str]]:
    """Load account last-4 digit mappings from the SQLite accounts table.

    Returns a dict mapping last-4 digits to (institution, account_name).
    Entries without a last4 are skipped (they exist only for lifecycle metadata).
    """
    from ledgerlift.store import get_connection  # noqa: PLC0415

    conn = get_connection()
    rows = conn.execute(
        "SELECT last4, institution, account_name FROM accounts WHERE last4 IS NOT NULL"
    ).fetchall()
    return {str(row["last4"]): (row["institution"], row["account_name"]) for row in rows}


def load_account_lifecycle() -> dict[tuple[str, str], dict[str, "date | None"]]:
    """Return {(institution, account_name): {"opened_date": date|None, "closed_date": date|None}}.

    Reads from the SQLite accounts table.
    Only entries with at least one of opened_date/closed_date are included.
    """
    from datetime import date as _date

    from ledgerlift.store import get_connection  # noqa: PLC0415

    conn = get_connection()
    rows = conn.execute(
        "SELECT institution, account_name, opened_date, closed_date FROM accounts"
    ).fetchall()

    out: dict[tuple[str, str], dict[str, _date | None]] = {}
    for row in rows:
        inst = row["institution"]
        acct = row["account_name"]
        if not inst or not acct:
            continue
        opened = row["opened_date"]
        closed = row["closed_date"]
        if opened is None and closed is None:
            continue
        out[(inst, acct)] = {
            "opened_date": _date.fromisoformat(opened) if isinstance(opened, str) else opened,
            "closed_date": _date.fromisoformat(closed) if isinstance(closed, str) else closed,
        }
    return out


# Lazy lookup, not a module-level constant: the SQLite DB may not exist
# yet at import time (e2e calls init_db() after this module is loaded).
def get_account_map() -> dict[str, tuple[str, str]]:
    return _load_account_map()

# Filename patterns for auto-resolution.
FILENAME_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # Chase: YYYYMMDD-statements-LAST4-.pdf
    (re.compile(r"^(\d{4})\d{4}-statements-(\d{4})-?\.pdf$", re.IGNORECASE), "chase_statement"),
    # Capital One: Statement_MMYYYY_LAST4.pdf
    (re.compile(r"^Statement_(\d{2})(\d{4})_(\d{4})\.pdf$", re.IGNORECASE), "capitalone_statement"),
    # Wealthfront Green Dot: GREEN_DOT_STATEMENT_YYYY-MM_ACCT_...pdf
    (re.compile(r"^GREEN_DOT_STATEMENT_(\d{4})-(\d{2})_", re.IGNORECASE), "wealthfront_greendot"),
    # Wealthfront brokerage: STATEMENT_YYYY-MM_ACCT_...pdf (but NOT Statement_MMYYYY which is C1)
    (re.compile(r"^STATEMENT_(\d{4})-(\d{2})_", re.IGNORECASE), "wealthfront_cash"),
    # Deserve: Month_YYYY_STATEMENT.pdf (e.g., May_2025_STATEMENT.pdf)
    (re.compile(r"^([A-Z][a-z]+)_(\d{4})_STATEMENT\.pdf$"), "deserve_credit"),
]

# Amex CSV expected columns
AMEX_CSV_COLUMNS = {
    "Date", "Description", "Amount", "Extended Details",
    "Appears On Your Statement As", "Category",
}


@dataclass
class IntakeResult:
    source: Path
    destination: Path
    institution: str
    account: str
    year: int
    copied: bool
    reason: str = ""


def _auto_parse_filename(filename: str) -> tuple[str, str, int] | None:
    """Try to auto-detect institution/account/year from a filename."""
    account_map = get_account_map()
    for pattern, kind in FILENAME_PATTERNS:
        m = pattern.match(filename)
        if not m:
            continue
        if kind == "chase_statement":
            year = int(m.group(1))
            last4 = m.group(2)
            mapping = account_map.get(last4)
            if mapping:
                return mapping[0], mapping[1], year
            logger.warning("Unknown account last-4: %s in file %s", last4, filename)
        elif kind == "capitalone_statement":
            year = int(m.group(2))
            last4 = m.group(3)
            mapping = account_map.get(last4)
            if mapping:
                return mapping[0], mapping[1], year
            logger.warning("Unknown account last-4: %s in file %s", last4, filename)
        elif kind == "wealthfront_greendot":
            year = int(m.group(1))
            return "wealthfront", "cash_greendot", year
        elif kind == "wealthfront_cash":
            year = int(m.group(1))
            return "wealthfront", "cash", year
        elif kind == "deserve_credit":
            year = int(m.group(2))
            return "deserve", "credit", year
    return None


def _detect_amex_csv(path: Path) -> tuple[str, str, int] | None:
    """Check if a CSV is an Amex activity export by inspecting its header and content.

    Returns (institution, account, year) based on the latest transaction date,
    or None if not an Amex CSV.
    """
    try:
        with open(path, newline="") as f:
            reader = csv.DictReader(f)
            header = set(reader.fieldnames or [])
            if not AMEX_CSV_COLUMNS.issubset(header):
                return None

            # Read dates to determine the year (use the latest date)
            latest: datetime | None = None
            for row in reader:
                try:
                    d = datetime.strptime(row["Date"].strip(), "%m/%d/%Y")
                    if latest is None or d > latest:
                        latest = d
                except (ValueError, KeyError):
                    continue

            if latest is None:
                return None

            return "amex", "credit", latest.year
    except Exception:
        return None


def _detect_sofi_pdf(path: Path) -> tuple[str, str, int] | None:
    """Check if a PDF is a SoFi statement by inspecting its content.

    Returns (institution, account, year) or None if not a SoFi PDF.
    """
    try:
        from ledgerlift.utils.pdf import extract_text_pages

        pages = extract_text_pages(path)
        if not pages:
            return None
        first_page = pages[0]
        if "SoFi Bank" not in first_page and "sofi.com" not in first_page:
            return None

        # Extract year from statement period
        m = re.search(
            r"Monthly Statement Period\s+\w+\s+\d+,\s+(\d{4})",
            first_page,
        )
        if m:
            year = int(m.group(1))
            return "sofi", "bank", year
        return None
    except Exception:
        return None


def _auto_parse(file_path: Path) -> tuple[str, str, int] | None:
    """Try to auto-detect institution/account/year from a file.

    Checks filename patterns first, then content-based detection for CSVs
    and PDFs with non-descriptive filenames (e.g., SoFi UUID filenames).
    """
    # Try filename-based detection
    result = _auto_parse_filename(file_path.name)
    if result:
        return result

    # Try content-based detection for CSVs
    if file_path.suffix.lower() == ".csv":
        return _detect_amex_csv(file_path)

    # Try content-based detection for PDFs with UUID-like filenames
    if file_path.suffix.lower() == ".pdf":
        return _detect_sofi_pdf(file_path)

    return None


def _prompt_for_destination(filename: str) -> tuple[str, str, int] | None:
    """Interactively ask the user where a file should go. Returns None to skip."""
    import click

    click.echo(f"\n  Cannot auto-detect destination for: {filename}")

    institutions = list(SUPPORTED_SOURCES.keys())
    inst_display = ", ".join(institutions)
    institution = click.prompt(
        f"    Institution ({inst_display}, or new name)",
        default=institutions[0] if len(institutions) == 1 else None,
    ).strip().lower()

    if not institution:
        return None

    accounts = SUPPORTED_SOURCES.get(institution, [])
    if accounts:
        acct_display = ", ".join(accounts)
        account = click.prompt(
            f"    Account ({acct_display}, or new name)",
            default=accounts[0] if len(accounts) == 1 else None,
        ).strip().lower()
    else:
        account = click.prompt("    Account name").strip().lower()

    if not account:
        return None

    year_str = click.prompt("    Statement year (YYYY)")
    try:
        year = int(year_str)
    except ValueError:
        click.echo(f"    Invalid year: {year_str}, skipping")
        return None

    if not (2000 <= year <= 2099):
        click.echo(f"    Year out of range: {year}, skipping")
        return None

    return institution, account, year


def plan_intake(
    source_dir: Path | None = None,
    interactive: bool = True,
) -> list[IntakeResult]:
    """Scan the statements drop folder and determine where each file should go.

    Picks up both PDFs and CSVs.
    """
    source_dir = source_dir or STATEMENTS_DIR
    if not source_dir.exists():
        logger.warning("Statements directory does not exist: %s", source_dir)
        return []

    results: list[IntakeResult] = []
    # Collect all supported file types
    files = sorted(
        list(source_dir.glob("*.pdf")) + list(source_dir.glob("*.csv"))
    )

    for file_path in files:
        parsed = _auto_parse(file_path)

        if parsed is None and interactive:
            parsed = _prompt_for_destination(file_path.name)

        if parsed is None:
            results.append(IntakeResult(
                source=file_path,
                destination=file_path,
                institution="",
                account="",
                year=0,
                copied=False,
                reason="Unrecognized file, skipped",
            ))
            continue

        institution, account, year = parsed
        dest_dir = RAW_DIR / institution / account / str(year)
        dest = dest_dir / file_path.name

        if dest.exists():
            results.append(IntakeResult(
                source=file_path,
                destination=dest,
                institution=institution,
                account=account,
                year=year,
                copied=False,
                reason="Already exists at destination",
            ))
            continue

        results.append(IntakeResult(
            source=file_path,
            destination=dest,
            institution=institution,
            account=account,
            year=year,
            copied=True,
        ))

    return results


def run_intake(
    source_dir: Path | None = None,
    dry_run: bool = False,
    interactive: bool = True,
) -> list[IntakeResult]:
    """Copy statement files from the drop folder into the correct raw directory structure.

    Files are copied (not moved) to keep an unsorted archive in the drop folder.
    """
    results = plan_intake(source_dir, interactive=interactive)

    for result in results:
        if not result.copied:
            continue

        if dry_run:
            logger.info("Would copy: %s -> %s", result.source, result.destination)
            continue

        result.destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(result.source), str(result.destination))
        logger.info("Copied: %s -> %s", result.source.name, result.destination)

    return results
