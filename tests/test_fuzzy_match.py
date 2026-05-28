"""Tests for fuzzy merchant matching."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import pytest
import yaml

from ledgerlift.enrich.engine import RuleEngine
from ledgerlift.enrich.fuzzy_match import FuzzyMerchantMatcher
from ledgerlift.models import CanonicalTransaction, Direction, TransactionType


def _make_txn(description: str) -> CanonicalTransaction:
    return CanonicalTransaction(
        transaction_id="test123",
        source_file_hash="hash123",
        source_file_path="/test.pdf",
        institution="chase",
        account_name="checking",
        account_type="checking",
        transaction_date=date(2025, 3, 15),
        description_raw=description,
        description_normalized=description,
        amount=Decimal("-50.00"),
        direction=Direction.DEBIT,
        transaction_type=TransactionType.PURCHASE,
        parser_name="test",
        parser_version="0.1.0",
        import_timestamp=datetime(2025, 6, 1),
    )


@dataclass
class MockRule:
    id: str
    pattern: str
    canonical_merchant: str
    category: str | None = None
    subcategory: str | None = None


class TestFuzzyMerchantMatcher:
    @pytest.fixture
    def matcher(self) -> FuzzyMerchantMatcher:
        rules = [
            MockRule("panini_kabob", "panini kabob grill", "Panini Kabob Grill", "Dining"),
            MockRule("costco", "costco", "Costco", "Groceries"),
            MockRule("target", "target", "Target", "Shopping"),
            MockRule("whole_foods", "whole foods market", "Whole Foods Market", "Groceries"),
        ]
        return FuzzyMerchantMatcher(rules)

    def test_close_match_returns_result(self, matcher: FuzzyMerchantMatcher) -> None:
        """Truncated or slightly different description should match."""
        result = matcher.find_match("panini kabob gril")
        assert result is not None
        assert result.canonical_merchant == "Panini Kabob Grill"
        assert 0.5 <= result.confidence <= 0.7

    def test_exact_match_high_score(self, matcher: FuzzyMerchantMatcher) -> None:
        result = matcher.find_match("costco")
        assert result is not None
        assert result.canonical_merchant == "Costco"
        assert result.score >= 95

    def test_low_similarity_returns_none(self, matcher: FuzzyMerchantMatcher) -> None:
        """Completely unrelated description should not match."""
        result = matcher.find_match("xyz random merchant abc")
        assert result is None

    def test_rule_id_prefixed_with_fuzzy(self, matcher: FuzzyMerchantMatcher) -> None:
        result = matcher.find_match("panini kabob")
        assert result is not None
        assert result.rule_id.startswith("fuzzy:")

    def test_empty_patterns(self) -> None:
        matcher = FuzzyMerchantMatcher([])
        result = matcher.find_match("anything")
        assert result is None

    def test_empty_description(self, matcher: FuzzyMerchantMatcher) -> None:
        result = matcher.find_match("")
        assert result is None


class TestFuzzyIntegration:
    """Test fuzzy matching integrated into the RuleEngine."""

    @pytest.fixture
    def engine(self, tmp_path: Path) -> RuleEngine:
        merchant_rules = {
            "rules": [
                {
                    "id": "panini_kabob",
                    "priority": 100,
                    "match": {"type": "contains", "pattern": "panini kabob grill"},
                    "canonical_merchant": "Panini Kabob Grill",
                    "category": "Dining",
                },
                {
                    "id": "costco",
                    "priority": 100,
                    "match": {"type": "contains", "pattern": "costco"},
                    "canonical_merchant": "Costco",
                    "category": "Groceries",
                },
            ]
        }
        mr = tmp_path / "merchants.yaml"
        cr = tmp_path / "categories.yaml"
        mr.write_text(yaml.dump(merchant_rules))
        cr.write_text(yaml.dump({"rules": []}))
        return RuleEngine(
            merchant_rules_path=mr,
            category_rules_path=cr,
            merchant_overrides_path=tmp_path / "mo.yaml",
            category_overrides_path=tmp_path / "co.yaml",
            enable_fuzzy=True,
        )

    @pytest.fixture
    def engine_no_fuzzy(self, tmp_path: Path) -> RuleEngine:
        merchant_rules = {
            "rules": [
                {
                    "id": "panini_kabob",
                    "priority": 100,
                    "match": {"type": "contains", "pattern": "panini kabob grill"},
                    "canonical_merchant": "Panini Kabob Grill",
                    "category": "Dining",
                },
            ]
        }
        mr = tmp_path / "merchants.yaml"
        cr = tmp_path / "categories.yaml"
        mr.write_text(yaml.dump(merchant_rules))
        cr.write_text(yaml.dump({"rules": []}))
        return RuleEngine(
            merchant_rules_path=mr,
            category_rules_path=cr,
            merchant_overrides_path=tmp_path / "mo.yaml",
            category_overrides_path=tmp_path / "co.yaml",
            enable_fuzzy=False,
        )

    def test_exact_rule_takes_priority(self, engine: RuleEngine) -> None:
        """Exact rule match should win over fuzzy."""
        txn = _make_txn("COSTCO WHOLESALE")
        result = engine.enrich(txn)
        assert result.merchant_normalized == "Costco"
        assert result.merchant_rule_id == "costco"  # exact match, not fuzzy

    def test_fuzzy_matches_close_description(self, engine: RuleEngine) -> None:
        """Fuzzy matching should catch truncated merchant names."""
        txn = _make_txn("PANINI KABOB GRIL UTC")
        result = engine.enrich(txn)
        assert result.merchant_normalized == "Panini Kabob Grill"
        assert result.merchant_rule_id is not None
        assert "fuzzy" in (result.merchant_rule_id or "")

    def test_fuzzy_assigns_category(self, engine: RuleEngine) -> None:
        txn = _make_txn("PANINI KABOB GRIL UTC")
        result = engine.enrich(txn)
        assert result.category_normalized == "Dining"

    def test_fuzzy_disabled(self, engine_no_fuzzy: RuleEngine) -> None:
        """With fuzzy disabled, truncated names should not match."""
        txn = _make_txn("PANINI KABOB GRIL UTC")
        result = engine_no_fuzzy.enrich(txn)
        # Should fall back to heuristic, not fuzzy match
        assert result.merchant_rule_id is None
        assert result.merchant_confidence == pytest.approx(0.3)
