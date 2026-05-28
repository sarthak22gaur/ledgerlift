"""Shared test fixtures."""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from ledgerlift.store import get_connection, init_db, reset_db


@pytest.fixture
def tmp_db(tmp_path: Path):
    """Initialise a temporary SQLite database and return (db_path, connection)."""
    db_file = tmp_path / "test.sqlite"
    init_db(db_file)
    conn = get_connection(db_file)
    return db_file, conn


@pytest.fixture
def sample_chase_text() -> str:
    """Sample Chase checking statement text matching real Chase PDF structure."""
    return textwrap.dedent("""\
        000000001231234
        CUSTOMER SERVICE INFORMATION
        12000000010106167130
        January 1, 2023 through January 31, 2023
        JPMorgan Chase Bank, N.A.
        Account Number:
        *start*summary
        Chase Total Checking
        CHECKING SUMMARY
        AMOUNT
        Beginning Balance $5,000.00
        Deposits and Additions 3,500.00
        Electronic Withdrawals -2,100.00
        ATM & Debit Card Withdrawals -630.01
        Fees & Other Withdrawals -7.50
        Ending Balance $5,762.49
        *end*summary
        *start*transaction detail
        TRANSACTION DETAIL
        DATE DESCRIPTION AMOUNT BALANCE
        Beginning Balance $5,000.00

        Deposits and Additions

        01/05 DIRECT DEP ACME CORP PAYROLL 2,500.00 7,500.00
        01/15 Online Transfer from SAV...1111 500.00 8,000.00
        01/20 Zelle payment from JOHN DOE 500.00 8,500.00

        Electronic Withdrawals

        01/03 CHASE CREDIT CRD AUTOPAY -500.00 4,500.00
        01/10 ACH Debit COMCAST CABLE -150.00 4,350.00
        Internet Service
        01/15 ACH Debit STATE FARM INSURANCE -200.00 4,150.00
        01/22 Online Transfer to SAV...2222 -250.00 3,900.00
        01/28 VENMO PAYMENT -100.00 3,800.00
        01/31 ACH Debit SPOTIFY USA -14.99 3,785.01

        ATM & Debit Card Withdrawals

        01/08 ATM WITHDRAWAL 123 MAIN ST -200.00 5,300.00
        01/17 DEBIT CARD PURCHASE WHOLE FOODS -85.01 5,214.99
        01/25 DEBIT CARD PURCHASE AMAZON.COM -300.00 4,914.99
        01/30 DEBIT CARD PURCHASE SHELL OIL -45.00 4,869.99

        Fees & Other Withdrawals

        01/31 SERVICE CHARGE -5.00 5,762.49
        01/31 ATM FEE -2.50 5,759.99
        Ending Balance $5,762.49
        *end*transaction detail
        *start*dre portrait disclosure message area
        IN CASE OF ERRORS OR QUESTIONS...
        *end*dre portrait disclosure message area
        Page of
        1 2
    """)


@pytest.fixture
def sample_chase_pdf(tmp_path: Path, sample_chase_text: str) -> Path:
    """Create a minimal PDF fixture from sample text using pdfplumber-compatible format."""
    text_path = tmp_path / "sample_statement.txt"
    text_path.write_text(sample_chase_text)
    return text_path
