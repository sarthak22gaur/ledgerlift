"""Tests for transaction normalization."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

import pytest

from ledgerlift.models import (
    Direction,
    ParsedStatement,
    RawTransaction,
    StatementMetadata,
    TransactionType,
)
from ledgerlift.normalize import (
    classify_transaction_type,
    generate_transaction_id,
    normalize_statement,
)
from ledgerlift.utils.money import parse_amount
from ledgerlift.utils.text import normalize_description


class TestClassifyTransactionType:
    def test_ach(self) -> None:
        assert classify_transaction_type("ACH Debit COMCAST") == TransactionType.ACH

    def test_transfer(self) -> None:
        assert classify_transaction_type("Online Transfer to SAV") == TransactionType.TRANSFER

    def test_zelle(self) -> None:
        assert classify_transaction_type("Zelle payment from JOHN") == TransactionType.TRANSFER

    def test_atm(self) -> None:
        assert classify_transaction_type("ATM WITHDRAWAL") == TransactionType.ATM

    def test_check(self) -> None:
        assert classify_transaction_type("Check #1234") == TransactionType.CHECK

    def test_fee(self) -> None:
        assert classify_transaction_type("SERVICE CHARGE") == TransactionType.FEE

    def test_deposit(self) -> None:
        assert classify_transaction_type("DIRECT DEP ACME CORP") == TransactionType.DEPOSIT

    def test_unknown(self) -> None:
        assert classify_transaction_type("MISC TRANSACTION") == TransactionType.UNKNOWN

    def test_section_fallback(self) -> None:
        assert (
            classify_transaction_type("SOMETHING", section="electronic withdrawals")
            == TransactionType.ACH
        )


class TestNormalizeDescription:
    def test_whitespace(self) -> None:
        assert normalize_description("  HELLO   WORLD  ") == "HELLO WORLD"

    def test_unicode_dashes(self) -> None:
        assert normalize_description("HELLO\u2014WORLD") == "HELLO-WORLD"

    def test_trailing_ref_number(self) -> None:
        assert normalize_description("PURCHASE #1234567890") == "PURCHASE"


class TestParseAmount:
    def test_simple(self) -> None:
        assert parse_amount("123.45") == Decimal("123.45")

    def test_with_dollar_sign(self) -> None:
        assert parse_amount("$1,234.56") == Decimal("1234.56")

    def test_negative(self) -> None:
        assert parse_amount("-$50.00") == Decimal("-50.00")

    def test_parens_negative(self) -> None:
        assert parse_amount("($50.00)") == Decimal("-50.00")

    def test_empty(self) -> None:
        assert parse_amount("") is None

    def test_invalid(self) -> None:
        assert parse_amount("abc") is None


class TestTransactionIdStability:
    def test_same_inputs_same_id(self) -> None:
        id1 = generate_transaction_id(
            "chase",
            "checking",
            "2023-01-15",
            "-50.00",
            "PURCHASE",
            "hash1",
            0,
            reference_number="ref1",
            raw_date_key="01/15",
        )
        id2 = generate_transaction_id(
            "chase",
            "checking",
            "2023-01-15",
            "-50.00",
            "PURCHASE",
            "hash1",
            0,
            reference_number="ref1",
            raw_date_key="01/15",
        )
        assert id1 == id2

    def test_different_inputs_different_id(self) -> None:
        id1 = generate_transaction_id(
            "chase", "checking", "2023-01-15", "-50.00", "PURCHASE", "hash1", 0
        )
        id2 = generate_transaction_id(
            "chase", "checking", "2023-01-16", "-50.00", "PURCHASE", "hash1", 0
        )
        assert id1 != id2

    def test_sequence_makes_same_natural_transaction_unique(self) -> None:
        id1 = generate_transaction_id(
            "chase", "checking", "2023-01-15", "-50.00", "PURCHASE", "hash1", 0
        )
        id2 = generate_transaction_id(
            "chase", "checking", "2023-01-15", "-50.00", "PURCHASE", "hash1", 1
        )
        assert id1 != id2


class TestNormalizeStatement:
    def _make_parsed(self, transactions: list[RawTransaction]) -> ParsedStatement:
        return ParsedStatement(
            source_file_hash="testhash123",
            source_file_path="/test/path.pdf",
            metadata=StatementMetadata(
                institution="chase",
                account_name="checking",
                statement_start_date=date(2023, 1, 1),
                statement_end_date=date(2023, 1, 31),
            ),
            raw_transactions=transactions,
            extracted_text="raw text",
            parser_name="chase_checking_pdf",
            parser_version="0.1.0",
        )

    def test_basic_normalization(self) -> None:
        parsed = self._make_parsed([
            RawTransaction(
                date_str="01/15",
                description="ACH Debit COMCAST CABLE",
                amount_str="150.00",
                direction=Direction.DEBIT,
            ),
        ])

        result = normalize_statement(parsed)
        assert len(result) == 1

        txn = result[0]
        assert txn.transaction_date == date(2023, 1, 15)
        assert txn.amount == Decimal("-150.00")
        assert txn.direction == Direction.DEBIT
        assert txn.transaction_type == TransactionType.ACH
        assert txn.institution == "chase"

    def test_credit_positive_amount(self) -> None:
        parsed = self._make_parsed([
            RawTransaction(
                date_str="01/05",
                description="DIRECT DEP ACME CORP",
                amount_str="2,500.00",
                direction=Direction.CREDIT,
            ),
        ])

        result = normalize_statement(parsed)
        assert len(result) == 1
        assert result[0].amount == Decimal("2500.00")
        assert result[0].direction == Direction.CREDIT

    def test_skips_unparseable(self) -> None:
        parsed = self._make_parsed([
            RawTransaction(
                date_str="invalid",
                description="BAD TRANSACTION",
                amount_str="abc",
            ),
        ])

        result = normalize_statement(parsed)
        assert len(result) == 0

    def test_duplicate_rows_get_distinct_ids(self) -> None:
        parsed = self._make_parsed([
            RawTransaction(
                date_str="01/10",
                description="PURCHASE",
                amount_str="50.00",
                direction=Direction.DEBIT,
            ),
            RawTransaction(
                date_str="01/10",
                description="PURCHASE",
                amount_str="50.00",
                direction=Direction.DEBIT,
            ),
        ])

        result = normalize_statement(parsed)
        assert len(result) == 2
        assert result[0].transaction_id != result[1].transaction_id
