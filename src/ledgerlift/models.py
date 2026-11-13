"""Data models for the LedgerLift pipeline."""

from __future__ import annotations

import enum
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class ParseStatus(str, enum.Enum):
    PENDING = "pending"
    PARSED = "parsed"
    FAILED = "failed"


class EnrichStatus(str, enum.Enum):
    PENDING = "pending"
    ENRICHED = "enriched"
    FAILED = "failed"


class Direction(str, enum.Enum):
    DEBIT = "debit"
    CREDIT = "credit"


class TransactionType(str, enum.Enum):
    PURCHASE = "purchase"
    ACH = "ach"
    FEE = "fee"
    INTEREST = "interest"
    CHECK = "check"
    TRANSFER = "transfer"
    ATM = "atm"
    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"
    PAYMENT = "payment"
    UNKNOWN = "unknown"


class SourceFileEntry(BaseModel):
    """Tracks state for a single source file in the SQLite store."""

    file_hash: str
    relative_path: str
    institution: str
    account_name: str
    parse_status: ParseStatus = ParseStatus.PENDING
    parse_error: str | None = None
    parsed_at: datetime | None = None
    enrich_status: EnrichStatus = EnrichStatus.PENDING
    enriched_at: datetime | None = None
    enriched_transaction_count: int | None = None
    unresolved_merchant_count: int | None = None
    unresolved_category_count: int | None = None
    created_at: datetime | None = None


class StatementMetadata(BaseModel):
    """Metadata extracted from a parsed statement."""

    institution: str
    account_name: str
    account_type: str = "checking"
    statement_start_date: date | None = None
    statement_end_date: date | None = None
    account_number_last4: str | None = None
    beginning_balance: Decimal | None = None
    ending_balance: Decimal | None = None
    total_credits: Decimal | None = None
    total_debits: Decimal | None = None


class RawTransaction(BaseModel):
    """A transaction as extracted directly from a statement, before normalization."""

    date_str: str
    description: str
    amount_str: str
    direction: Direction | None = None
    reference_number: str | None = None
    section: str | None = None


class ParsedStatement(BaseModel):
    """Complete result of parsing a single statement PDF."""

    source_file_hash: str
    source_file_path: str
    metadata: StatementMetadata
    raw_transactions: list[RawTransaction]
    extracted_text: str
    warnings: list[str] = Field(default_factory=list)
    extraction_errors: list[str] = Field(default_factory=list)
    empty_statement: bool = False
    parser_name: str
    parser_version: str


class CanonicalTransaction(BaseModel):
    """Normalized transaction in the canonical output schema."""

    transaction_id: str
    source_file_hash: str
    source_file_path: str
    institution: str
    account_name: str
    account_type: str
    statement_start_date: date | None = None
    statement_end_date: date | None = None
    transaction_date: date
    posted_date: date | None = None
    description_raw: str
    description_normalized: str
    amount: Decimal
    currency: str = "USD"
    direction: Direction
    transaction_type: TransactionType = TransactionType.UNKNOWN
    category_raw: str | None = None
    category_normalized: str | None = None
    reference_number: str | None = None
    parser_name: str
    parser_version: str
    import_timestamp: datetime
    merchant_normalized: str | None = None
    merchant_confidence: float | None = None
    merchant_rule_id: str | None = None
    category_confidence: float | None = None
    category_rule_id: str | None = None
    subcategory_normalized: str | None = None
    is_transfer_candidate: bool = False
    is_internal_payment_candidate: bool = False
    transfer_pair_id: str | None = None
    transfer_match_confidence: float | None = None
    enriched_at: datetime | None = None

