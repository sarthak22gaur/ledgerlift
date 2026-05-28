"""Text cleaning utilities for merchant normalization."""

from __future__ import annotations

import re
import unicodedata

# All 50 US states + DC + territories
_US_STATE_CODES = frozenset({
    "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga",
    "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md",
    "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj",
    "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc",
    "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy",
    "dc", "pr", "vi", "gu", "as", "mp",
})

# Common business suffixes to strip
_BUSINESS_SUFFIXES = re.compile(
    r"\b(inc|llc|ltd|corp|co|dba|l\.l\.c|l\.p)\b\.?",
    re.IGNORECASE,
)

# Abbreviation expansions for merchant candidates
_ABBREVIATIONS: dict[str, str] = {
    "whse": "warehouse",
    "mkt": "market",
    "pharm": "pharmacy",
    "intl": "international",
    "svc": "service",
    "svcs": "services",
    "dept": "department",
    "ctr": "center",
    "govt": "government",
    "natl": "national",
    "assn": "association",
    "univ": "university",
}


def clean_for_matching(text: str) -> str:
    """Aggressively clean a description for rule matching."""
    s = text

    s = unicodedata.normalize("NFC", s)
    s = re.sub(r"[\u2010-\u2015]", "-", s)
    s = re.sub(r"[\u2018\u2019]", "'", s)
    s = re.sub(r"[\u201c\u201d]", '"', s)

    s = s.lower()
    s = re.sub(r"^(sq \*|tst\*? ?|dd \*|pp\*)", "", s)
    s = re.sub(r"^(recurring )?card purchase( with pin)?( return)?\s*\d{2}/\d{2}\s*", "", s)
    s = re.sub(r"^\d{2}/\d{2}\s+", "", s)
    s = re.sub(r"\s*\d[\d\s-]{8,}\d\s*$", "", s)
    s = re.sub(r"\s+[A-Za-z0-9]{8,}$", "", s)
    s = re.sub(r"\s+card\s+\d{4}\s*$", "", s, flags=re.IGNORECASE)
    s = re.sub(r"#\s*\d{2,}", "", s)
    s = re.sub(r"\s+(?:store|ste|loc|str)\s*#?\s*\d+", " ", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+\d{5}(-\d{4})?\s*$", "", s)
    s = re.sub(r",\s*([a-z]{2})\s*$", lambda m: "" if m.group(1) in _US_STATE_CODES else m.group(0), s)
    s = _strip_trailing_city_state(s)
    s = re.sub(
        r"\s+([a-z]{2})\s*$",
        lambda m: "" if m.group(1) in _US_STATE_CODES else m.group(0),
        s,
    )
    s = re.sub(r"\s{2,}[\w\s]{2,20}\s*$", "", s)
    s = _BUSINESS_SUFFIXES.sub("", s)
    s = re.sub(r"\s+https?://\S+", "", s)
    s = re.sub(r"\s+www\.\S+", "", s)
    s = re.sub(r"\s+amzn\.com\S*", "", s)
    s = re.sub(r"\s+help\.[\w.]+", "", s)
    s = re.sub(r"\s*[*#]+\s*", " ", s)
    s = re.sub(r"\s+", " ", s).strip()

    return s


def _strip_trailing_city_state(s: str) -> str:
    """Strip trailing 'city state' pattern from a description.

    Only strips if:
    - There's a double-space (or more) gap before the city name
    - The trailing token is a known US state code
    - There's at least 5 chars of merchant name remaining
    - The city is 1-3 words
    """
    # Require 2+ spaces between merchant and city to avoid stripping merchant words
    m = re.search(r"^(.{5,}?)\s{2,}(\w+(?:\s+\w+){0,2})\s+([a-z]{2})\s*$", s)
    if m and m.group(3) in _US_STATE_CODES:
        return m.group(1).strip()
    return s


def extract_merchant_candidate(description_normalized: str) -> str:
    """Extract a best-effort merchant name from a normalized description."""
    s = clean_for_matching(description_normalized)

    s = re.sub(r"\s+\S*\d{3,}\S*\s*$", "", s)
    s = re.sub(r"\s+\S*\d{3,}\S*\s*$", "", s)

    for abbr, expansion in _ABBREVIATIONS.items():
        s = re.sub(rf"\b{re.escape(abbr)}\b", expansion, s)

    if len(s) > 40:
        cut = s[:40].rfind(" ")
        if cut > 15:
            s = s[:cut]
        else:
            s = s[:40]

    return s.title().strip()
