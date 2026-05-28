"""Transaction normalization: raw parsed data -> canonical schema."""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime
from decimal import Decimal

from ledgerlift.models import (
    CanonicalTransaction,
    Direction,
    ParsedStatement,
    RawTransaction,
    TransactionType,
)
from ledgerlift.utils.dates import parse_transaction_date
from ledgerlift.utils.money import parse_amount
from ledgerlift.utils.text import normalize_description

logger = logging.getLogger(__name__)

# Keywords for classifying transaction types
TYPE_KEYWORDS: list[tuple[re.Pattern[str], TransactionType]] = [
    (re.compile(r"\bACH\b", re.IGNORECASE), TransactionType.ACH),
    (re.compile(r"\bOnline Transfer\b", re.IGNORECASE), TransactionType.TRANSFER),
    (re.compile(r"\bZelle\b", re.IGNORECASE), TransactionType.TRANSFER),
    (re.compile(r"\bWire\b", re.IGNORECASE), TransactionType.TRANSFER),
    (re.compile(r"\bATM\b", re.IGNORECASE), TransactionType.ATM),
    (re.compile(r"\bCheck\s*#?\d", re.IGNORECASE), TransactionType.CHECK),
    (re.compile(r"\bFee\b", re.IGNORECASE), TransactionType.FEE),
    (re.compile(r"\bService Charge\b", re.IGNORECASE), TransactionType.FEE),
    (re.compile(r"\bInterest\b", re.IGNORECASE), TransactionType.INTEREST),
    (re.compile(r"\bDeposit\b", re.IGNORECASE), TransactionType.DEPOSIT),
    (re.compile(r"\bWithdrawal\b", re.IGNORECASE), TransactionType.WITHDRAWAL),
    (re.compile(r"\bPayment\b", re.IGNORECASE), TransactionType.PAYMENT),
    (re.compile(r"\bDirect Dep\b", re.IGNORECASE), TransactionType.DEPOSIT),
    (re.compile(r"\bPurchase\b", re.IGNORECASE), TransactionType.PURCHASE),
    (re.compile(r"\bDebit Card\b", re.IGNORECASE), TransactionType.PURCHASE),
]


def classify_transaction_type(description: str, section: str | None = None) -> TransactionType:
    """Classify a transaction type based on description and section."""
    for pattern, txn_type in TYPE_KEYWORDS:
        if pattern.search(description):
            return txn_type

    # Fall back to section-based classification
    if section:
        section_lower = section.lower()
        if "check" in section_lower:
            return TransactionType.CHECK
        if "atm" in section_lower:
            return TransactionType.ATM
        if "fee" in section_lower:
            return TransactionType.FEE
        if "deposit" in section_lower:
            return TransactionType.DEPOSIT
        if "electronic" in section_lower:
            return TransactionType.ACH

    return TransactionType.UNKNOWN


def generate_transaction_id(
    institution: str,
    account_name: str,
    transaction_date: str,
    amount: str,
    description: str,
    source_file_hash: str,
    sequence_in_statement: int,
    reference_number: str | None = None,
    raw_date_key: str | None = None,
) -> str:
    """Generate a stable, deterministic transaction ID."""
    components = (
        f"{institution}|{account_name}|{transaction_date}|{amount}|{description}|"
        f"{source_file_hash}|{sequence_in_statement}|{reference_number or ''}|"
        f"{raw_date_key or ''}"
    )
    return hashlib.sha256(components.encode()).hexdigest()[:16]


def normalize_statement(
    parsed: ParsedStatement, statement_year: int | None = None
) -> list[CanonicalTransaction]:
    """Normalize all transactions from a parsed statement into canonical form."""
    year = statement_year
    if year is None and parsed.metadata.statement_end_date:
        year = parsed.metadata.statement_end_date.year
    if year is None and parsed.metadata.statement_start_date:
        year = parsed.metadata.statement_start_date.year
    if year is None:
        logger.warning("No year available for normalization, using current year")
        year = datetime.now().year

    now = datetime.now()
    canonical: list[CanonicalTransaction] = []

    for sequence_in_statement, raw_txn in enumerate(parsed.raw_transactions):
        txn = _normalize_transaction(
            raw_txn,
            parsed,
            year,
            now,
            sequence_in_statement,
        )
        if txn is not None:
            canonical.append(txn)
        else:
            logger.warning(
                "Skipping unparseable transaction: date=%s desc=%s amount=%s",
                raw_txn.date_str,
                raw_txn.description[:50],
                raw_txn.amount_str,
            )

    return canonical


def _normalize_transaction(
    raw: RawTransaction,
    parsed: ParsedStatement,
    year: int,
    import_ts: datetime,
    sequence_in_statement: int,
) -> CanonicalTransaction | None:
    txn_date = parse_transaction_date(raw.date_str, year)
    if txn_date is None:
        return None

    # Handle year boundary: if statement spans a year boundary (e.g., Dec-Jan),
    # transactions in a month before the end date's month need the prior year.
    if parsed.metadata.statement_start_date and parsed.metadata.statement_end_date:
        start = parsed.metadata.statement_start_date
        end = parsed.metadata.statement_end_date
        if start.year < end.year and txn_date.month >= start.month:
            txn_date = txn_date.replace(year=start.year)

    amount = parse_amount(raw.amount_str)
    if amount is None:
        return None

    direction = raw.direction or Direction.DEBIT

    if direction == Direction.DEBIT:
        amount = -abs(amount)
    else:
        amount = abs(amount)

    desc_normalized = normalize_description(raw.description)
    txn_type = classify_transaction_type(raw.description, raw.section)

    # SoFi PDFs contain both checking and savings in one statement.
    # Split savings into a separate account so balances don't conflict.
    account_name = parsed.metadata.account_name
    account_type = parsed.metadata.account_type
    if parsed.metadata.institution == "sofi" and raw.section == "savings":
        account_name = "savings"
        account_type = "savings"

    txn_id = generate_transaction_id(
        institution=parsed.metadata.institution,
        account_name=account_name,
        transaction_date=txn_date.isoformat(),
        amount=str(amount),
        description=desc_normalized,
        source_file_hash=parsed.source_file_hash,
        sequence_in_statement=sequence_in_statement,
        reference_number=raw.reference_number,
        raw_date_key=raw.date_str,
    )

    # Amex CSVs provide rich categories like "Restaurant-Restaurant" (contains dash, title-case).
    category_raw = None
    if raw.section and "-" in raw.section and raw.section[0].isupper():
        category_raw = raw.section

    return CanonicalTransaction(
        transaction_id=txn_id,
        source_file_hash=parsed.source_file_hash,
        source_file_path=parsed.source_file_path,
        institution=parsed.metadata.institution,
        account_name=account_name,
        account_type=account_type,
        statement_start_date=parsed.metadata.statement_start_date,
        statement_end_date=parsed.metadata.statement_end_date,
        transaction_date=txn_date,
        description_raw=raw.description,
        description_normalized=desc_normalized,
        amount=amount,
        direction=direction,
        transaction_type=txn_type,
        category_raw=category_raw,
        reference_number=raw.reference_number,
        parser_name=parsed.parser_name,
        parser_version=parsed.parser_version,
        import_timestamp=import_ts,
    )
