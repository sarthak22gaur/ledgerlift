"""Tests for the enrichment engine: merchant normalization and category assignment."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import pytest
import yaml

from ledgerlift.enrich.engine import RuleEngine
from ledgerlift.enrich.text_cleaning import clean_for_matching
from ledgerlift.config import CATEGORY_RULES_BASE_PATH, MERCHANT_RULES_BASE_PATH
from ledgerlift.models import CanonicalTransaction, Direction, TransactionType


def _make_txn(
    description: str = "TEST PURCHASE",
    amount: Decimal = Decimal("-50.00"),
    direction: Direction = Direction.DEBIT,
    transaction_type: TransactionType = TransactionType.PURCHASE,
    institution: str = "chase",
    account_name: str = "checking",
) -> CanonicalTransaction:
    return CanonicalTransaction(
        transaction_id="test123",
        source_file_hash="hash123",
        source_file_path="/test.pdf",
        institution=institution,
        account_name=account_name,
        account_type=account_name,
        transaction_date=date(2025, 3, 15),
        description_raw=description,
        description_normalized=description,
        amount=amount,
        direction=direction,
        transaction_type=transaction_type,
        parser_name="test",
        parser_version="0.1.0",
        import_timestamp=datetime(2025, 6, 1),
    )


@pytest.mark.parametrize(
    ("description", "transaction_type", "is_cash"),
    [
        ("ACH Direct Withdrawal - EXAMPLE VENDOR", TransactionType.ACH, False),
        ("Electronic Withdrawal EXAMPLE VENDOR", TransactionType.WITHDRAWAL, False),
        ("ATM Withdrawal", TransactionType.ATM, True),
        ("07/18 Withdrawal", TransactionType.WITHDRAWAL, True),
        ("Non-Chase ATM Withdraw", TransactionType.ATM, True),
        ("Cash Withdrawal", TransactionType.WITHDRAWAL, True),
    ],
)
def test_cash_withdrawal_requires_cash_evidence(
    description: str, transaction_type: TransactionType, is_cash: bool
) -> None:
    rules = yaml.safe_load(CATEGORY_RULES_BASE_PATH.read_text())["rules"]
    engine = RuleEngine(
        _merchant_rules_raw=[],
        _category_rules_raw=rules,
        _merchant_overrides_raw=[],
        _category_overrides_raw=[],
        _internal_counterparties=set(),
        enable_fuzzy=False,
    )
    result = engine.enrich(_make_txn(description, transaction_type=transaction_type))
    assert (result.category_normalized == "ATM / Cash Withdrawal") is is_cash


# --- Text cleaning tests ---


class TestTextCleaning:
    def test_clean_removes_sq_prefix(self) -> None:
        assert "blue bottle" in clean_for_matching("SQ *BLUE BOTTLE COFFEE")

    def test_clean_removes_dd_prefix(self) -> None:
        assert "doordash" in clean_for_matching("DD *DOORDASH CHIPOTL")

    def test_clean_removes_card_purchase_prefix(self) -> None:
        result = clean_for_matching("Card Purchase 11/13 Nidhi Caterers TX Card 1207")
        assert "nidhi" in result
        assert "card purchase" not in result


# --- Merchant rule tests ---


class TestMerchantRules:
    @pytest.fixture
    def engine(self, tmp_path: Path) -> RuleEngine:
        merchant_rules = {
            "rules": [
                {
                    "id": "amazon",
                    "priority": 100,
                    "match": {"type": "regex", "pattern": "amzn|amazon"},
                    "canonical_merchant": "Amazon",
                    "category": "Shopping",
                },
                {
                    "id": "costco",
                    "priority": 100,
                    "match": {"type": "contains", "pattern": "costco"},
                    "canonical_merchant": "Costco",
                    "category": "Groceries",
                },
                {
                    "id": "uber_eats",
                    "priority": 110,
                    "match": {"type": "regex", "pattern": r"uber\s*eats"},
                    "canonical_merchant": "Uber Eats",
                    "category": "Dining",
                },
                {
                    "id": "uber_ride",
                    "priority": 100,
                    "match": {"type": "regex", "pattern": r"\buber\b(?!\s*eats)"},
                    "canonical_merchant": "Uber",
                    "category": "Transportation",
                },
            ]
        }
        category_rules = {
            "rules": [
                {
                    "id": "transfer_zelle",
                    "priority": 140,
                    "when": {"description_regex": "(?i)zelle"},
                    "assign": {"category": "Transfers", "confidence": 0.9},
                },
            ]
        }
        mr = tmp_path / "merchants.yaml"
        cr = tmp_path / "categories.yaml"
        mr.write_text(yaml.dump(merchant_rules))
        cr.write_text(yaml.dump(category_rules))
        return RuleEngine(
            merchant_rules_path=mr,
            category_rules_path=cr,
            merchant_overrides_path=tmp_path / "mo.yaml",
            category_overrides_path=tmp_path / "co.yaml",
        )

    def test_amazon_match(self, engine: RuleEngine) -> None:
        txn = _make_txn("AMZN Mktp US*AB12C Amzn.com/bill WA")
        result = engine.enrich(txn)
        assert result.merchant_normalized == "Amazon"
        assert result.merchant_rule_id == "amazon"
        assert result.merchant_confidence == pytest.approx(0.95)

    def test_costco_match(self, engine: RuleEngine) -> None:
        txn = _make_txn("COSTCO WHSE #0401 SAN DIEGO CA")
        result = engine.enrich(txn)
        assert result.merchant_normalized == "Costco"
        assert result.category_normalized == "Groceries"

    def test_uber_eats_higher_priority(self, engine: RuleEngine) -> None:
        """Uber Eats (priority 110) should win over Uber (priority 100)."""
        txn = _make_txn("UBER EATS HELP.UBER.COM CA")
        result = engine.enrich(txn)
        assert result.merchant_normalized == "Uber Eats"
        assert result.category_normalized == "Dining"

    def test_uber_ride_not_eats(self, engine: RuleEngine) -> None:
        txn = _make_txn("UBER TRIP 12345")
        result = engine.enrich(txn)
        assert result.merchant_normalized == "Uber"
        assert result.category_normalized == "Transportation"

    def test_unresolved_gets_heuristic(self, engine: RuleEngine) -> None:
        txn = _make_txn("RANDOM UNKNOWN MERCHANT XYZ")
        result = engine.enrich(txn)
        assert result.merchant_normalized  # Should have a heuristic candidate
        assert result.merchant_rule_id is None  # No rule matched
        assert result.merchant_confidence < 0.5

    def test_merchant_sets_category(self, engine: RuleEngine) -> None:
        txn = _make_txn("COSTCO WHSE #0401 SAN DIEGO CA")
        result = engine.enrich(txn)
        assert result.category_normalized == "Groceries"
        assert result.category_rule_id == "costco"

    def test_category_rule_fallback(self, engine: RuleEngine) -> None:
        txn = _make_txn("Zelle Payment From John Doe 12345")
        result = engine.enrich(txn)
        assert result.category_normalized == "Transfers"
        assert result.category_rule_id == "transfer_zelle"


class TestBaseRuleIntegration:
    @pytest.fixture
    def engine(self, tmp_path: Path) -> RuleEngine:
        ic = tmp_path / "internal_counterparties.yaml"
        ic.write_text(yaml.dump({"counterparties": []}))
        return RuleEngine(
            merchant_rules_path=MERCHANT_RULES_BASE_PATH,
            category_rules_path=CATEGORY_RULES_BASE_PATH,
            merchant_overrides_path=tmp_path / "mo.yaml",
            category_overrides_path=tmp_path / "co.yaml",
            internal_counterparties_path=ic,
        )

    def test_atm_withdrawal_uses_atm_category(self, engine: RuleEngine) -> None:
        txn = _make_txn(
            "ATM WITHDRAWAL 123 MAIN ST",
            transaction_type=TransactionType.ATM,
        )
        result = engine.enrich(txn)
        assert result.merchant_normalized == "Chase"
        assert result.category_normalized == "ATM / Cash Withdrawal"
        assert result.is_transfer_candidate is False

    def test_plain_withdrawal_uses_atm_category(self, engine: RuleEngine) -> None:
        txn = _make_txn(
            "07/18 Withdrawal",
            direction=Direction.DEBIT,
            transaction_type=TransactionType.WITHDRAWAL,
        )
        result = engine.enrich(txn)
        assert result.merchant_normalized == "Chase"
        assert result.category_normalized == "ATM / Cash Withdrawal"
        assert result.is_transfer_candidate is False

    def test_base_zelle_reports_transfer_without_pair_candidate(self, engine: RuleEngine) -> None:
        txn = _make_txn("Zelle Payment To Harshita")
        result = engine.enrich(txn)
        assert result.merchant_normalized == "Zelle"
        assert result.category_normalized == "Transfers"
        assert result.subcategory_normalized == "Zelle"
        assert result.is_transfer_candidate is False

    def test_base_venmo_reports_transfer_without_pair_candidate(self, engine: RuleEngine) -> None:
        txn = _make_txn("Venmo Payment To Alex")
        result = engine.enrich(txn)
        assert result.merchant_normalized == "Venmo"
        assert result.category_normalized == "Transfers"
        assert result.subcategory_normalized == "Venmo"
        assert result.is_transfer_candidate is False


# --- Category rule tests ---


class TestCategoryRules:
    @pytest.fixture
    def engine(self, tmp_path: Path) -> RuleEngine:
        merchant_rules = {"rules": []}
        category_rules = {
            "rules": [
                {
                    "id": "income",
                    "priority": 150,
                    "when": {
                        "transaction_type": ["deposit"],
                        "direction": "credit",
                    },
                    "assign": {"category": "Income", "confidence": 0.9},
                },
                {
                    "id": "fee_type",
                    "priority": 130,
                    "when": {"transaction_type": ["fee"]},
                    "assign": {"category": "Fees", "confidence": 0.95},
                },
            ]
        }
        mr = tmp_path / "merchants.yaml"
        cr = tmp_path / "categories.yaml"
        mr.write_text(yaml.dump(merchant_rules))
        cr.write_text(yaml.dump(category_rules))
        return RuleEngine(
            merchant_rules_path=mr,
            category_rules_path=cr,
            merchant_overrides_path=tmp_path / "mo.yaml",
            category_overrides_path=tmp_path / "co.yaml",
        )

    def test_income_by_type_and_direction(self, engine: RuleEngine) -> None:
        txn = _make_txn(
            "DIRECT DEP ACME CORP",
            amount=Decimal("2500.00"),
            direction=Direction.CREDIT,
            transaction_type=TransactionType.DEPOSIT,
        )
        result = engine.enrich(txn)
        assert result.category_normalized == "Income"

    def test_fee_by_type(self, engine: RuleEngine) -> None:
        txn = _make_txn(
            "SERVICE CHARGE",
            transaction_type=TransactionType.FEE,
        )
        result = engine.enrich(txn)
        assert result.category_normalized == "Fees"

    def test_type_fallback(self, engine: RuleEngine) -> None:
        """Transaction-type fallback should apply when no explicit rule matches."""
        txn = _make_txn(
            "INTEREST PAYMENT",
            amount=Decimal("0.50"),
            direction=Direction.CREDIT,
            transaction_type=TransactionType.INTEREST,
        )
        result = engine.enrich(txn)
        assert result.category_normalized == "Interest"

    def test_uncategorized_default(self, engine: RuleEngine) -> None:
        txn = _make_txn("SOMETHING RANDOM")
        result = engine.enrich(txn)
        assert result.category_normalized == "Uncategorized"


# --- Override tests ---


class TestOverrides:
    @pytest.fixture
    def engine(self, tmp_path: Path) -> RuleEngine:
        merchant_rules = {
            "rules": [{
                "id": "amazon",
                "priority": 100,
                "match": {"type": "contains", "pattern": "amazon"},
                "canonical_merchant": "Amazon",
                "category": "Shopping",
            }]
        }
        merchant_overrides = {
            "overrides": [{
                "id": "amazon_pantry_groceries",
                "pattern": "AMAZON PANTRY",
                "merchant": "Amazon Pantry",
                "category": "Groceries",
            }]
        }
        mr = tmp_path / "merchants.yaml"
        mo = tmp_path / "merchant_overrides.yaml"
        cr = tmp_path / "categories.yaml"
        co = tmp_path / "category_overrides.yaml"
        mr.write_text(yaml.dump(merchant_rules))
        mo.write_text(yaml.dump(merchant_overrides))
        cr.write_text(yaml.dump({"rules": []}))
        co.write_text(yaml.dump({"overrides": []}))
        return RuleEngine(
            merchant_rules_path=mr,
            category_rules_path=cr,
            merchant_overrides_path=mo,
            category_overrides_path=co,
        )

    def test_override_takes_precedence(self, engine: RuleEngine) -> None:
        txn = _make_txn("AMAZON PANTRY ORDER 12345")
        result = engine.enrich(txn)
        assert result.merchant_normalized == "Amazon Pantry"
        assert result.category_normalized == "Groceries"
        assert "override" in (result.merchant_rule_id or "")

    def test_non_override_uses_rule(self, engine: RuleEngine) -> None:
        txn = _make_txn("AMAZON MARKETPLACE ORDER 67890")
        result = engine.enrich(txn)
        assert result.merchant_normalized == "Amazon"
        assert result.category_normalized == "Shopping"


# --- Transfer detection tests ---


class TestTransferDetection:
    @pytest.fixture
    def engine(self, tmp_path: Path) -> RuleEngine:
        mr = tmp_path / "merchants.yaml"
        cr = tmp_path / "categories.yaml"
        ic = tmp_path / "internal_counterparties.yaml"
        mr.write_text(yaml.dump({
            "rules": [
                {
                    "id": "internal_bank",
                    "priority": 100,
                    "match": {"type": "contains", "pattern": "internal bank"},
                    "canonical_merchant": "Internal Bank",
                    "category": "Transfers",
                },
            ]
        }))
        cr.write_text(yaml.dump({
            "rules": [
                {
                    "id": "transfer_zelle",
                    "priority": 140,
                    "when": {"description_regex": "(?i)zelle"},
                    "assign": {
                        "category": "Transfers",
                        "subcategory": "Zelle",
                        "confidence": 0.95,
                    },
                },
                {
                    "id": "transfer_bank",
                    "priority": 130,
                    "when": {"description_regex": "(?i)online transfer"},
                    "assign": {
                        "category": "Transfers",
                        "subcategory": "Bank Transfer",
                        "confidence": 0.9,
                    },
                },
            ]
        }))
        ic.write_text(yaml.dump({"counterparties": ["Internal Bank"]}))
        return RuleEngine(
            merchant_rules_path=mr,
            category_rules_path=cr,
            merchant_overrides_path=tmp_path / "mo.yaml",
            category_overrides_path=tmp_path / "co.yaml",
            internal_counterparties_path=ic,
        )

    def test_zelle_is_reported_as_transfer_but_not_pair_candidate(self, engine: RuleEngine) -> None:
        txn = _make_txn("Zelle Payment From John Doe")
        result = engine.enrich(txn)
        assert result.category_normalized == "Transfers"
        assert result.subcategory_normalized == "Zelle"
        assert result.is_transfer_candidate is False

    def test_bank_transfer_subcategory_is_transfer_candidate(self, engine: RuleEngine) -> None:
        txn = _make_txn("Online Transfer To Savings")
        result = engine.enrich(txn)
        assert result.category_normalized == "Transfers"
        assert result.subcategory_normalized == "Bank Transfer"
        assert result.is_transfer_candidate is True

    def test_configured_counterparty_is_transfer_candidate(self, engine: RuleEngine) -> None:
        txn = _make_txn("Payment To Internal Bank")
        result = engine.enrich(txn)
        assert result.merchant_normalized == "Internal Bank"
        assert result.is_transfer_candidate is True

    def test_autopay_is_internal(self, engine: RuleEngine) -> None:
        txn = _make_txn("AUTOMATIC PAYMENT - THANK YOU")
        result = engine.enrich(txn)
        assert result.is_internal_payment_candidate is True

    def test_purchase_is_not_transfer(self, engine: RuleEngine) -> None:
        txn = _make_txn("COSTCO PURCHASE")
        result = engine.enrich(txn)
        assert result.is_transfer_candidate is False
        assert result.is_internal_payment_candidate is False


# --- Rule loading tests ---


class TestRuleLoading:
    def test_empty_rules(self, tmp_path: Path) -> None:
        mr = tmp_path / "merchants.yaml"
        cr = tmp_path / "categories.yaml"
        mr.write_text(yaml.dump({"rules": []}))
        cr.write_text(yaml.dump({"rules": []}))
        engine = RuleEngine(
            merchant_rules_path=mr,
            category_rules_path=cr,
            merchant_overrides_path=tmp_path / "mo.yaml",
            category_overrides_path=tmp_path / "co.yaml",
        )
        txn = _make_txn("SOME PURCHASE")
        result = engine.enrich(txn)
        assert result.category_normalized == "Uncategorized"

    def test_missing_files_ok(self, tmp_path: Path) -> None:
        """Engine should work even if rule files don't exist."""
        engine = RuleEngine(
            merchant_rules_path=tmp_path / "nonexistent.yaml",
            category_rules_path=tmp_path / "also_nonexistent.yaml",
            merchant_overrides_path=tmp_path / "mo.yaml",
            category_overrides_path=tmp_path / "co.yaml",
        )
        txn = _make_txn("SOME PURCHASE")
        result = engine.enrich(txn)
        assert result.enriched_at is not None
