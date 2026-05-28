"""Fuzzy merchant matching using rapidfuzz string similarity."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from rapidfuzz import fuzz, process

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FuzzyMatch:
    """Result of a fuzzy merchant match."""

    rule_id: str
    canonical_merchant: str
    category: str | None
    subcategory: str | None
    score: float  # 0-100 rapidfuzz score
    confidence: float  # 0.0-1.0 mapped confidence


class FuzzyMerchantMatcher:
    """Matches descriptions against merchant patterns using rapidfuzz token_set_ratio."""

    def __init__(
        self,
        rules: list,  # list[MerchantRule] — avoid circular import
        min_score: float = 75.0,
        max_confidence: float = 0.7,
    ) -> None:
        self.min_score = min_score
        self.max_confidence = max_confidence

        self._pattern_to_rule: dict[str, object] = {}
        self._patterns: list[str] = []

        for rule in rules:
            pattern = rule.pattern.lower()
            if pattern and pattern not in self._pattern_to_rule:
                self._pattern_to_rule[pattern] = rule
                self._patterns.append(pattern)

        logger.debug("FuzzyMerchantMatcher initialized with %d patterns", len(self._patterns))

    def find_match(self, cleaned_description: str) -> FuzzyMatch | None:
        if not self._patterns or not cleaned_description:
            return None

        result = process.extractOne(
            cleaned_description,
            self._patterns,
            scorer=fuzz.token_set_ratio,
            score_cutoff=self.min_score,
        )

        if result is None:
            return None

        matched_pattern, score, _ = result
        rule = self._pattern_to_rule[matched_pattern]

        score_range = 100.0 - self.min_score
        if score_range > 0:
            confidence = 0.5 + (score - self.min_score) / score_range * (self.max_confidence - 0.5)
        else:
            confidence = self.max_confidence

        return FuzzyMatch(
            rule_id=f"fuzzy:{rule.id}",
            canonical_merchant=rule.canonical_merchant,
            category=rule.category,
            subcategory=rule.subcategory,
            score=score,
            confidence=round(confidence, 3),
        )
