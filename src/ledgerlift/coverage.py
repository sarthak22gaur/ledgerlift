"""Statement coverage analysis: find missing months across all accounts."""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class AccountCoverage:
    institution: str
    account_name: str
    statement_count: int
    first_date: date
    last_date: date
    covered_months: set[tuple[int, int]]  # (year, month)
    missing_months: list[tuple[int, int]]  # (year, month), sorted
    opened_date: date | None = None
    closed_date: date | None = None


def analyze_coverage(up_to: date | None = None) -> list[AccountCoverage]:
    """Analyze statement coverage for all accounts.

    Reads statement date ranges from the SQLite store.
    """
    if up_to is None:
        up_to = date.today()

    from ledgerlift.store import get_connection, init_db  # noqa: PLC0415
    from ledgerlift.intake import load_account_lifecycle  # noqa: PLC0415

    lifecycle = load_account_lifecycle()

    db_path = init_db()
    conn = get_connection(db_path)

    stmt_rows = conn.execute(
        "SELECT institution, account_name, statement_start_date, statement_end_date "
        "FROM statements"
    ).fetchall()

    accounts: dict[tuple[str, str], list[tuple[date, date]]] = defaultdict(list)
    for row in stmt_rows:
        inst = row["institution"]
        acct = row["account_name"]
        start = row["statement_start_date"]
        end = row["statement_end_date"]
        if not inst or not acct or not start or not end:
            continue
        try:
            start_d = date.fromisoformat(start)
            end_d = date.fromisoformat(end)
        except ValueError:
            continue
        accounts[(inst, acct)].append((start_d, end_d))

    results: list[AccountCoverage] = []

    for (inst, acct), periods in sorted(accounts.items()):
        periods.sort()

        first_date = periods[0][0]
        last_date = periods[-1][1]

        covered: set[tuple[int, int]] = set()
        for start_d, end_d in periods:
            y, m = start_d.year, start_d.month
            while (y, m) <= (end_d.year, end_d.month):
                covered.add((y, m))
                m += 1
                if m > 12:
                    m = 1
                    y += 1

        lc = lifecycle.get((inst, acct), {})
        opened = lc.get("opened_date")
        closed = lc.get("closed_date")

        start_ym = (first_date.year, first_date.month)
        if opened is not None:
            start_ym = min(start_ym, (opened.year, opened.month))

        end_ym = (up_to.year, up_to.month)
        if closed is not None:
            end_ym = min(end_ym, (closed.year, closed.month))

        expected: list[tuple[int, int]] = []
        y, m = start_ym
        while (y, m) <= end_ym:
            expected.append((y, m))
            m += 1
            if m > 12:
                m = 1
                y += 1

        missing = sorted(ym for ym in expected if ym not in covered)

        results.append(AccountCoverage(
            institution=inst,
            account_name=acct,
            statement_count=len(periods),
            first_date=first_date,
            last_date=last_date,
            covered_months=covered,
            missing_months=missing,
            opened_date=opened,
            closed_date=closed,
        ))

    return results


def format_month(year: int, month: int) -> str:
    """Format (year, month) as 'YYYY-MM'."""
    return f"{year}-{month:02d}"
