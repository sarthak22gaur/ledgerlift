"""Rule engine for merchant normalization and category assignment."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import yaml

from ledgerlift.enrich.fuzzy_match import FuzzyMerchantMatcher
from ledgerlift.enrich.text_cleaning import clean_for_matching, extract_merchant_candidate
from ledgerlift.models import CanonicalTransaction

logger = logging.getLogger(__name__)

INTERNAL_SUBCATEGORIES = frozenset({"Internal Transfer", "Bank Transfer"})


@dataclass
class MerchantRule:
    id: str
    priority: int
    match_type: str  # "regex", "contains", "exact", "prefix"
    pattern: str
    canonical_merchant: str
    category: str | None = None
    subcategory: str | None = None
    compiled: re.Pattern[str] | None = field(default=None, repr=False)


@dataclass
class CategoryRule:
    id: str
    priority: int
    category: str
    subcategory: str | None = None
    confidence: float = 0.9
    # Match conditions (all specified conditions must match)
    merchant_normalized: list[str] | None = None
    description_regex: str | None = None
    transaction_type: list[str] | None = None
    direction: str | None = None
    institution: str | None = None
    account_name: str | None = None
    compiled_desc: re.Pattern[str] | None = field(default=None, repr=False)


@dataclass
class Override:
    """Manual override for a specific transaction or description pattern."""
    id: str
    pattern: str | None = None  # regex on description_raw
    transaction_id: str | None = None
    merchant: str | None = None
    category: str | None = None
    subcategory: str | None = None
    compiled: re.Pattern[str] | None = field(default=None, repr=False)


def _load_yaml(path: Path) -> dict | list | None:
    if not path.exists():
        return None
    with open(path) as f:
        return yaml.safe_load(f)


def _merge_rule_lists(base: list[dict], user: list[dict]) -> list[dict]:
    """User rules with the same id override base; new user ids are added."""
    base_by_id = {r["id"]: r for r in base}
    user_by_id = {r["id"]: r for r in user}
    merged = {**base_by_id, **user_by_id}
    return list(merged.values())


def _load_layered_rules(base_path: Path, user_path: Path) -> list[dict]:
    base_data = _load_yaml(base_path)
    user_data = _load_yaml(user_path)

    base_rules = base_data.get("rules", []) if isinstance(base_data, dict) else []
    user_rules = user_data.get("rules", []) if isinstance(user_data, dict) else []

    if base_rules and user_rules:
        return _merge_rule_lists(base_rules, user_rules)
    return user_rules or base_rules


def _load_internal_counterparties(path: Path) -> set[str]:
    data = _load_yaml(path)
    if not isinstance(data, dict):
        return set()
    counterparties = data.get("counterparties", [])
    if not isinstance(counterparties, list):
        logger.warning("Ignoring invalid internal counterparties file: %s", path)
        return set()
    return {name.strip() for name in counterparties if isinstance(name, str) and name.strip()}


def _compile_merchant_rules(raw: list[dict]) -> list[MerchantRule]:
    rules: list[MerchantRule] = []
    for r in raw:
        rule_id = r["id"]
        priority = r.get("priority", 0)
        match = r.get("match", {})
        match_type = match.get("type", "regex")
        pattern = match.get("pattern", "")

        compiled = None
        if match_type == "regex":
            try:
                compiled = re.compile(pattern, re.IGNORECASE)
            except re.error as e:
                logger.error("Bad regex in merchant rule %s: %s", rule_id, e)
                continue
        elif match_type == "contains":
            compiled = re.compile(re.escape(pattern), re.IGNORECASE)
        elif match_type == "prefix":
            compiled = re.compile(r"^" + re.escape(pattern), re.IGNORECASE)
        elif match_type == "exact":
            compiled = re.compile(r"^" + re.escape(pattern) + r"$", re.IGNORECASE)

        rules.append(MerchantRule(
            id=rule_id,
            priority=priority,
            match_type=match_type,
            pattern=pattern,
            canonical_merchant=r["canonical_merchant"],
            category=r.get("category"),
            subcategory=r.get("subcategory"),
            compiled=compiled,
        ))

    rules.sort(key=lambda r: -r.priority)
    return rules


def _compile_category_rules(raw: list[dict]) -> list[CategoryRule]:
    rules: list[CategoryRule] = []
    for r in raw:
        rule_id = r["id"]
        compiled_desc = None
        desc_regex = r.get("when", {}).get("description_regex")
        if desc_regex:
            try:
                compiled_desc = re.compile(desc_regex, re.IGNORECASE)
            except re.error as e:
                logger.error("Bad regex in category rule %s: %s", rule_id, e)
                continue

        when = r.get("when", {})
        assign = r.get("assign", {})

        rules.append(CategoryRule(
            id=rule_id,
            priority=r.get("priority", 0),
            category=assign.get("category", "Uncategorized"),
            subcategory=assign.get("subcategory"),
            confidence=assign.get("confidence", 0.9),
            merchant_normalized=when.get("merchant_normalized"),
            description_regex=desc_regex,
            transaction_type=when.get("transaction_type"),
            direction=when.get("direction"),
            institution=when.get("institution"),
            account_name=when.get("account_name"),
            compiled_desc=compiled_desc,
        ))

    rules.sort(key=lambda r: -r.priority)
    return rules


def _compile_overrides(raw: list[dict]) -> list[Override]:
    overrides: list[Override] = []
    for r in raw:
        compiled = None
        pattern = r.get("pattern")
        if pattern:
            try:
                compiled = re.compile(pattern, re.IGNORECASE)
            except re.error as e:
                logger.error("Bad regex in override %s: %s", r.get("id"), e)
                continue
        overrides.append(Override(
            id=r["id"],
            pattern=pattern,
            transaction_id=r.get("transaction_id"),
            merchant=r.get("merchant"),
            category=r.get("category"),
            subcategory=r.get("subcategory"),
            compiled=compiled,
        ))
    return overrides


TYPE_CATEGORY_MAP = {
    "fee": "Fees",
    "interest": "Interest",
    "atm": "ATM / Cash Withdrawal",
    "check": "Check",
    "deposit": "Income",
}

SOURCE_CATEGORY_MAP: dict[str, tuple[str, str | None]] = {
    "Restaurant-Restaurant": ("Dining", None),
    "Restaurant-Bar & Café": ("Dining", "Bar & Cafe"),
    "Restaurant-": ("Dining", None),
    "Merchandise & Supplies-Groceries": ("Groceries", None),
    "Merchandise & Supplies-Internet Purchase": ("Shopping", "Online Shopping"),
    "Merchandise & Supplies-Wholesale Stores": ("Groceries", None),
    "Merchandise & Supplies-Clothing Stores": ("Shopping", "Clothing"),
    "Merchandise & Supplies-Department Stores": ("Shopping", None),
    "Merchandise & Supplies-Computer Supplies": ("Shopping", "Technology"),
    "Merchandise & Supplies-Electronics Stores": ("Shopping", "Technology"),
    "Merchandise & Supplies-General Retail": ("Shopping", None),
    "Merchandise & Supplies-Pharmacies": ("Shopping", "Pharmacy"),
    "Merchandise & Supplies-": ("Shopping", None),
    "Communications-Cable & Internet Comm": ("Utilities", "Internet"),
    "Communications-Telephone Services": ("Utilities", "Phone"),
    "Communications-": ("Utilities", None),
    "Transportation-Taxis & Coach": ("Transportation", "Rideshare"),
    "Transportation-Fuel": ("Transportation", "Gas"),
    "Transportation-Parking Charges": ("Transportation", "Parking"),
    "Transportation-Auto Services": ("Transportation", "Auto"),
    "Transportation-Rail Services": ("Transportation", "Transit"),
    "Transportation-": ("Transportation", None),
    "Entertainment-Theatrical Events": ("Entertainment", None),
    "Entertainment-": ("Entertainment", None),
    "Business Services-Insurance Services": ("Insurance", None),
    "Business Services-Health Care Services": ("Medical", None),
    "Business Services-Internet Services": ("Subscriptions", "Software"),
    "Business Services-Banking Services": ("Fees", None),
    "Business Services-": ("Shopping", "Services"),
    "Fees & Adjustments-": ("Fees", None),
    "Other-Government Services": ("Fees", "Government"),
    "Other-Education": ("Education", None),
    "Other-": ("Shopping", None),
    "Travel-Airline": ("Travel", "Flights"),
    "Travel-Lodging": ("Travel", "Lodging"),
    "Travel-": ("Travel", None),
}


class RuleEngine:
    """Applies merchant and category rules to enrich transactions."""

    def __init__(
        self,
        merchant_rules_path: Path | None = None,
        category_rules_path: Path | None = None,
        merchant_overrides_path: Path | None = None,
        category_overrides_path: Path | None = None,
        internal_counterparties_path: Path | None = None,
        enable_fuzzy: bool = True,
        # Pre-loaded rule lists (used by from_db())
        _merchant_rules_raw: list[dict] | None = None,
        _category_rules_raw: list[dict] | None = None,
        _merchant_overrides_raw: list[dict] | None = None,
        _category_overrides_raw: list[dict] | None = None,
        _internal_counterparties: set[str] | None = None,
    ) -> None:
        self.merchant_rules: list[MerchantRule] = []
        self.category_rules: list[CategoryRule] = []
        self.merchant_overrides: list[Override] = []
        self.category_overrides: list[Override] = []
        self.internal_counterparties: set[str] = set()
        self.fuzzy_matcher: FuzzyMerchantMatcher | None = None

        if _merchant_rules_raw is not None:
            raw_mr = _merchant_rules_raw
        elif merchant_rules_path:
            mr_data = _load_yaml(merchant_rules_path)
            raw_mr = mr_data.get("rules", []) if isinstance(mr_data, dict) else []
        else:
            from ledgerlift.config import (  # noqa: PLC0415
                CATEGORY_RULES_BASE_PATH,
                MERCHANT_RULES_BASE_PATH,
            )
            from ledgerlift.config import RULES_DIR  # noqa: PLC0415
            _user_merchant_path = RULES_DIR / "merchants.yaml"
            raw_mr = _load_layered_rules(MERCHANT_RULES_BASE_PATH, _user_merchant_path)

        if raw_mr:
            self.merchant_rules = _compile_merchant_rules(raw_mr)
            logger.info("Loaded %d merchant rules", len(self.merchant_rules))

        if _category_rules_raw is not None:
            raw_cr = _category_rules_raw
        elif category_rules_path:
            cr_data = _load_yaml(category_rules_path)
            raw_cr = cr_data.get("rules", []) if isinstance(cr_data, dict) else []
        else:
            from ledgerlift.config import (  # noqa: PLC0415
                CATEGORY_RULES_BASE_PATH,
                RULES_DIR,
            )
            _user_category_path = RULES_DIR / "categories.yaml"
            raw_cr = _load_layered_rules(CATEGORY_RULES_BASE_PATH, _user_category_path)

        if raw_cr:
            self.category_rules = _compile_category_rules(raw_cr)
            logger.info("Loaded %d category rules", len(self.category_rules))

        if _merchant_overrides_raw is not None:
            self.merchant_overrides = _compile_overrides(_merchant_overrides_raw)
        else:
            mo_path = merchant_overrides_path
            if mo_path is None:
                from ledgerlift.config import RULES_DIR  # noqa: PLC0415
                mo_path = RULES_DIR / "merchant_overrides.yaml"
            mo_data = _load_yaml(mo_path)
            if mo_data and isinstance(mo_data, dict):
                self.merchant_overrides = _compile_overrides(mo_data.get("overrides", []))

        if _category_overrides_raw is not None:
            self.category_overrides = _compile_overrides(_category_overrides_raw)
        else:
            co_path = category_overrides_path
            if co_path is None:
                from ledgerlift.config import RULES_DIR  # noqa: PLC0415
                co_path = RULES_DIR / "category_overrides.yaml"
            co_data = _load_yaml(co_path)
            if co_data and isinstance(co_data, dict):
                self.category_overrides = _compile_overrides(co_data.get("overrides", []))

        if _internal_counterparties is not None:
            self.internal_counterparties = _internal_counterparties
        else:
            ic_path = internal_counterparties_path
            if ic_path is None:
                from ledgerlift.config import RULES_DIR  # noqa: PLC0415
                ic_path = RULES_DIR / "internal_counterparties.yaml"
            self.internal_counterparties = _load_internal_counterparties(ic_path)

        if self.internal_counterparties:
            logger.info("Loaded %d internal counterparties", len(self.internal_counterparties))

        if enable_fuzzy and self.merchant_rules:
            self.fuzzy_matcher = FuzzyMerchantMatcher(self.merchant_rules)

    @classmethod
    def from_db(
        cls,
        conn: "sqlite3.Connection",
        enable_fuzzy: bool = True,
    ) -> "RuleEngine":
        """Construct a RuleEngine by loading rules from the SQLite store."""
        import sqlite3  # noqa: PLC0415
        from ledgerlift.store import (  # noqa: PLC0415
            list_category_overrides,
            list_category_rules,
            list_internal_counterparties,
            list_merchant_overrides,
            list_merchant_rules,
        )

        raw_merchant = list_merchant_rules(conn)
        raw_category = list_category_rules(conn)

        def _override_rows_to_dicts(rows: list[dict]) -> list[dict]:
            return [
                {
                    "id": r["id"],
                    "pattern": r.get("pattern"),
                    "transaction_id": r.get("transaction_id"),
                    "merchant": r.get("merchant"),
                    "category": r.get("category"),
                    "subcategory": r.get("subcategory"),
                }
                for r in rows
            ]

        raw_mo = _override_rows_to_dicts(list_merchant_overrides(conn))
        raw_co = _override_rows_to_dicts(list_category_overrides(conn))
        ic_names = set(list_internal_counterparties(conn))

        return cls(
            enable_fuzzy=enable_fuzzy,
            _merchant_rules_raw=raw_merchant,
            _category_rules_raw=raw_category,
            _merchant_overrides_raw=raw_mo,
            _category_overrides_raw=raw_co,
            _internal_counterparties=ic_names,
        )

    def enrich(self, txn: CanonicalTransaction) -> CanonicalTransaction:
        """Apply all enrichment rules to a transaction.

        Returns a new CanonicalTransaction with enrichment fields populated.
        """
        updates: dict = {"enriched_at": datetime.now()}

        desc_norm = txn.description_normalized
        desc_clean = clean_for_matching(desc_norm)

        merchant_resolved = False
        category_resolved = False

        for ov in self.merchant_overrides:
            if self._override_matches(ov, txn):
                if ov.merchant:
                    updates["merchant_normalized"] = ov.merchant
                    updates["merchant_confidence"] = 1.0
                    updates["merchant_rule_id"] = f"override:{ov.id}"
                    merchant_resolved = True
                if ov.category:
                    updates["category_normalized"] = ov.category
                    updates["category_confidence"] = 1.0
                    updates["category_rule_id"] = f"override:{ov.id}"
                    updates["subcategory_normalized"] = ov.subcategory
                    category_resolved = True
                break

        for ov in self.category_overrides:
            if not category_resolved and self._override_matches(ov, txn):
                if ov.category:
                    updates["category_normalized"] = ov.category
                    updates["category_confidence"] = 1.0
                    updates["category_rule_id"] = f"override:{ov.id}"
                    updates["subcategory_normalized"] = ov.subcategory
                    category_resolved = True
                break

        if not merchant_resolved:
            for rule in self.merchant_rules:
                if rule.compiled and rule.compiled.search(desc_clean):
                    updates["merchant_normalized"] = rule.canonical_merchant
                    updates["merchant_confidence"] = 0.95
                    updates["merchant_rule_id"] = rule.id
                    merchant_resolved = True

                    if rule.category and not category_resolved:
                        updates["category_normalized"] = rule.category
                        updates["category_confidence"] = 0.9
                        updates["category_rule_id"] = rule.id
                        updates["subcategory_normalized"] = rule.subcategory
                        category_resolved = True
                    break

        if not category_resolved:
            for rule in self.category_rules:
                if self._category_rule_matches(rule, txn, updates.get("merchant_normalized")):
                    updates["category_normalized"] = rule.category
                    updates["category_confidence"] = rule.confidence
                    updates["category_rule_id"] = rule.id
                    updates["subcategory_normalized"] = rule.subcategory
                    category_resolved = True
                    break

        if not category_resolved and txn.category_raw:
            mapped = self._map_source_category(txn.category_raw)
            if mapped:
                cat, subcat = mapped
                updates["category_normalized"] = cat
                updates["category_confidence"] = 0.85
                updates["category_rule_id"] = f"source:{txn.category_raw}"
                if subcat:
                    updates["subcategory_normalized"] = subcat
                category_resolved = True

        if not category_resolved:
            txn_type = txn.transaction_type.value if txn.transaction_type else None
            if txn_type in TYPE_CATEGORY_MAP:
                updates["category_normalized"] = TYPE_CATEGORY_MAP[txn_type]
                updates["category_confidence"] = 0.7
                updates["category_rule_id"] = f"type:{txn_type}"
                category_resolved = True

        if not category_resolved:
            updates["category_normalized"] = "Uncategorized"
            updates["category_confidence"] = 0.0
            updates["category_rule_id"] = None

        if not merchant_resolved and self.fuzzy_matcher:
            fuzzy_result = self.fuzzy_matcher.find_match(desc_clean)
            if fuzzy_result:
                updates["merchant_normalized"] = fuzzy_result.canonical_merchant
                updates["merchant_confidence"] = fuzzy_result.confidence
                updates["merchant_rule_id"] = fuzzy_result.rule_id
                merchant_resolved = True

                if fuzzy_result.category and not category_resolved:
                    updates["category_normalized"] = fuzzy_result.category
                    updates["category_confidence"] = round(fuzzy_result.confidence * 0.9, 3)
                    updates["category_rule_id"] = fuzzy_result.rule_id
                    updates["subcategory_normalized"] = fuzzy_result.subcategory
                    category_resolved = True

        if not merchant_resolved:
            updates["merchant_normalized"] = extract_merchant_candidate(desc_norm)
            updates["merchant_confidence"] = 0.3
            updates["merchant_rule_id"] = None

        resolved_category = updates.get("category_normalized") or txn.category_normalized
        resolved_subcategory = updates.get("subcategory_normalized") or txn.subcategory_normalized
        resolved_merchant = updates.get("merchant_normalized") or txn.merchant_normalized
        # Sweeps are one-sided (only one leg in statements) and can never pair.
        no_pair_expected = resolved_subcategory in ("Internal Sweep",)
        legacy_internal_payment = self._is_internal_payment(txn)

        updates["is_transfer_candidate"] = (
            not no_pair_expected
            and (
                resolved_subcategory in INTERNAL_SUBCATEGORIES
                or legacy_internal_payment
                or resolved_merchant in self.internal_counterparties
            )
        )
        updates["is_internal_payment_candidate"] = (
            not no_pair_expected
            and (legacy_internal_payment or resolved_category == "Credit Card Payment")
        )

        return txn.model_copy(update=updates)

    def _category_rule_matches(
        self,
        rule: CategoryRule,
        txn: CanonicalTransaction,
        merchant_norm: str | None = None,
    ) -> bool:
        if rule.merchant_normalized:
            effective_merchant = merchant_norm or txn.merchant_normalized or ""
            if effective_merchant not in rule.merchant_normalized:
                return False

        if rule.compiled_desc:
            text = f"{txn.description_normalized} {txn.description_raw}"
            if not rule.compiled_desc.search(text):
                return False

        if rule.transaction_type:
            if txn.transaction_type.value not in rule.transaction_type:
                return False

        if rule.direction:
            if txn.direction.value != rule.direction:
                return False

        if rule.institution:
            if txn.institution != rule.institution:
                return False

        if rule.account_name:
            if txn.account_name != rule.account_name:
                return False

        return True

    @staticmethod
    def _override_matches(override: Override, txn: CanonicalTransaction) -> bool:
        if override.transaction_id:
            return txn.transaction_id == override.transaction_id
        if override.compiled:
            return bool(override.compiled.search(txn.description_raw))
        return False

    @staticmethod
    def _map_source_category(category_raw: str) -> tuple[str, str | None] | None:
        if category_raw in SOURCE_CATEGORY_MAP:
            return SOURCE_CATEGORY_MAP[category_raw]
        for prefix, mapping in SOURCE_CATEGORY_MAP.items():
            if prefix.endswith("-") and category_raw.startswith(prefix):
                return mapping
        return None

    @staticmethod
    def _is_transfer_candidate(txn: CanonicalTransaction) -> bool:
        desc = txn.description_normalized.lower()
        keywords = ["transfer", "xfer", "zelle", "venmo", "online payment"]
        if txn.transaction_type.value in ("transfer", "ach"):
            return True
        return any(kw in desc for kw in keywords)

    @staticmethod
    def _is_internal_payment(txn: CanonicalTransaction) -> bool:
        desc = txn.description_normalized.lower()
        keywords = [
            "autopay", "auto pay", "automatic payment",
            "payment - thank you", "payment thank you",
            "credit crd", "credit card",
            "capital one autopay", "chase credit",
        ]
        return any(kw in desc for kw in keywords)
