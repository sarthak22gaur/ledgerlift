"""Text normalization utilities."""

from __future__ import annotations

import re
import unicodedata


def normalize_whitespace(text: str) -> str:
    """Collapse multiple whitespace characters into single spaces and strip."""
    return re.sub(r"\s+", " ", text).strip()


def normalize_unicode(text: str) -> str:
    """Normalize unicode to NFC form and replace common problem characters."""
    text = unicodedata.normalize("NFC", text)
    # Replace common unicode dashes/hyphens with ASCII hyphen
    text = re.sub(r"[\u2010\u2011\u2012\u2013\u2014\u2015]", "-", text)
    # Replace smart quotes
    text = re.sub(r"[\u2018\u2019]", "'", text)
    text = re.sub(r"[\u201c\u201d]", '"', text)
    return text


def normalize_description(desc: str) -> str:
    """Normalize a transaction description for matching and display."""
    desc = normalize_unicode(desc)
    desc = normalize_whitespace(desc)
    # Remove trailing reference numbers like #1234567890
    desc = re.sub(r"\s*#\d{5,}$", "", desc)
    return desc


def clean_raw_text(text: str) -> str:
    """Clean raw extracted PDF text."""
    text = normalize_unicode(text)
    # Remove null bytes
    text = text.replace("\x00", "")
    return text
