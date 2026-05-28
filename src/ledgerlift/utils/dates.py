"""Date parsing utilities for financial statements."""

from __future__ import annotations

import re
from datetime import date

# Common date formats in Chase statements
# e.g., "01/15", "01/15/2023", "January 15, 2023", "01/15/23"
DATE_PATTERNS = [
    (re.compile(r"(\d{2})/(\d{2})/(\d{4})"), "%m/%d/%Y"),
    (re.compile(r"(\d{2})/(\d{2})/(\d{2})"), "%m/%d/%y"),
    (re.compile(r"(\d{2})/(\d{2})"), "%m/%d"),
]

MONTH_NAMES = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}

MONTH_ABBR = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4,
    "may": 5, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

STATEMENT_PERIOD_RE = re.compile(
    r"(?:through|thru|to|-)\s+"
    r"(\w+ \d{1,2},?\s*\d{4})",
    re.IGNORECASE,
)

PERIOD_RANGE_RE = re.compile(
    r"(\w+ \d{1,2},?\s*\d{4})\s*(?:through|thru|to|-)\s*(\w+ \d{1,2},?\s*\d{4})",
    re.IGNORECASE,
)


def parse_date_mmdd(date_str: str, year: int) -> date | None:
    """Parse a MM/DD date string with an assumed year."""
    match = re.match(r"(\d{1,2})/(\d{1,2})", date_str.strip())
    if not match:
        return None
    month, day = int(match.group(1)), int(match.group(2))
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_date_mon_dd(date_str: str, year: int) -> date | None:
    """Parse a 'Mon DD' date string (e.g. 'Feb 24', 'Mar 7') with an assumed year."""
    s = date_str.strip()
    m = re.match(r"([A-Za-z]{3})\s+(\d{1,2})", s)
    if not m:
        return None
    month_str = m.group(1).lower()
    month = MONTH_ABBR.get(month_str)
    if month is None:
        return None
    day = int(m.group(2))
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_date_mmddyyyy(date_str: str) -> date | None:
    """Parse a MM/DD/YYYY date string (e.g. '02/22/2026')."""
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", date_str.strip())
    if not m:
        return None
    try:
        return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    except ValueError:
        return None


def parse_date_mon_dd_yyyy(date_str: str) -> date | None:
    """Parse a 'Mon DD, YYYY' date string (e.g. 'Aug 31, 2025')."""
    s = date_str.strip()
    m = re.match(r"([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})", s)
    if not m:
        return None
    month = MONTH_ABBR.get(m.group(1).lower())
    if month is None:
        return None
    try:
        return date(int(m.group(3)), month, int(m.group(2)))
    except ValueError:
        return None


def parse_transaction_date(date_str: str, year: int) -> date | None:
    """Parse a transaction date in any supported format.

    Handles:
    - "MM/DD/YYYY" (Amex, Wealthfront Green Dot)
    - "Mon DD, YYYY" (SoFi)
    - "MM/DD" (Chase)
    - "Mon DD" (Capital One)
    - "Mon DD | Mon DD" (Capital One with post date — uses the trans date part)
    """
    s = date_str.strip()

    # Capital One: "Feb 8 | Feb 9" — take the trans date (before |)
    if "|" in s:
        s = s.split("|")[0].strip()

    # Try MM/DD/YYYY first (has its own year, ignores `year` param)
    result = parse_date_mmddyyyy(s)
    if result:
        return result

    # Try Mon DD, YYYY (SoFi — has its own year, ignores `year` param)
    result = parse_date_mon_dd_yyyy(s)
    if result:
        return result

    # Try MM/DD (uses provided year)
    result = parse_date_mmdd(s, year)
    if result:
        return result

    # Try Mon DD
    return parse_date_mon_dd(s, year)


def parse_date_full(date_str: str) -> date | None:
    """Parse a full date string like 'January 15, 2023' or '01/15/2023'."""
    s = date_str.strip()

    # Try MM/DD/YYYY
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
        except ValueError:
            pass

    # Try "Month DD, YYYY"
    m = re.match(r"(\w+)\s+(\d{1,2}),?\s*(\d{4})", s)
    if m:
        month_name = m.group(1).lower()
        month_num = MONTH_NAMES.get(month_name)
        if month_num:
            try:
                return date(int(m.group(3)), month_num, int(m.group(2)))
            except ValueError:
                pass

    return None


def extract_statement_period(text: str) -> tuple[date | None, date | None]:
    """Try to extract statement start and end dates from statement text."""
    m = PERIOD_RANGE_RE.search(text)
    if m:
        start = parse_date_full(m.group(1))
        end = parse_date_full(m.group(2))
        if start and end:
            return start, end
    return None, None


def infer_year_from_path(path_str: str) -> int | None:
    """Try to extract a year from a file path like .../2023/..."""
    m = re.search(r"/(\d{4})/", path_str)
    if m:
        year = int(m.group(1))
        if 2000 <= year <= 2099:
            return year
    return None
