"""Money parsing and formatting utilities."""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation


def parse_amount(amount_str: str) -> Decimal | None:
    """Parse a dollar amount string into a Decimal.

    Handles formats like: "$1,234.56", "1234.56", "-$50.00", "($50.00)"
    """
    s = amount_str.strip()
    if not s:
        return None

    # Detect negative: leading minus or parentheses
    negative = False
    if s.startswith("-"):
        negative = True
        s = s[1:]
    elif s.startswith("(") and s.endswith(")"):
        negative = True
        s = s[1:-1]

    # Strip dollar sign and commas
    s = s.replace("$", "").replace(",", "").strip()

    if not s:
        return None

    try:
        amount = Decimal(s)
    except InvalidOperation:
        return None

    if negative:
        amount = -amount

    return amount


def format_amount(amount: Decimal) -> str:
    """Format a Decimal amount as a string with 2 decimal places."""
    return f"{amount:.2f}"
