"""Tests for enhanced text cleaning and merchant candidate extraction."""

from __future__ import annotations

from ledgerlift.enrich.text_cleaning import clean_for_matching, extract_merchant_candidate


class TestCleanForMatching:
    def test_strip_store_number_hash(self) -> None:
        result = clean_for_matching("COSTCO WHSE #0401 SAN DIEGO CA")
        assert "#" not in result
        assert "0401" not in result

    def test_strip_store_keyword(self) -> None:
        result = clean_for_matching("TARGET STORE 1234 SOMEWHERE TX")
        assert "1234" not in result

    def test_strip_trailing_zip(self) -> None:
        result = clean_for_matching("TARGET T-1234 SAN DIEGO CA 92101")
        assert "92101" not in result

    def test_strip_zip_plus_four(self) -> None:
        result = clean_for_matching("MERCHANT NAME 92101-1234")
        assert "92101" not in result

    def test_strip_comma_state(self) -> None:
        result = clean_for_matching("MERCHANT NAME, CA")
        assert result.strip() == "merchant name"

    def test_strip_trailing_city_state_with_store_number(self) -> None:
        """After store number removal creates double-space gap, city+state is stripped."""
        result = clean_for_matching("PANINI KABOB GRILL #123 SAN DIEGO CA")
        assert "san diego" not in result
        assert "panini" in result
        assert "kabob" in result

    def test_short_name_not_stripped_as_state(self) -> None:
        """ATT should not be stripped as a state code (too short to be city+state)."""
        result = clean_for_matching("ATT PAYMENT")
        assert "att" in result

    def test_strip_business_suffix_inc(self) -> None:
        result = clean_for_matching("ACME CORP INC")
        assert "inc" not in result.split()

    def test_strip_business_suffix_llc(self) -> None:
        result = clean_for_matching("SOME BUSINESS LLC")
        assert "llc" not in result.split()

    def test_strip_business_suffix_dba(self) -> None:
        result = clean_for_matching("COMPANY DBA TRADENAME")
        assert "dba" not in result.split()

    def test_preserves_core_merchant(self) -> None:
        result = clean_for_matching("COSTCO WHSE #0401 SAN DIEGO CA")
        assert "costco" in result


class TestExtractMerchantCandidate:
    def test_costco_warehouse_expansion(self) -> None:
        result = extract_merchant_candidate("COSTCO WHSE #0401 SAN DIEGO CA")
        assert "Warehouse" in result or "warehouse" in result.lower()
        assert "Costco" in result

    def test_target_strips_state_and_zip(self) -> None:
        result = extract_merchant_candidate("TARGET T-1234 SAN DIEGO CA 92101")
        assert "92101" not in result
        # State code is stripped; city may remain without a city database
        assert "ca" not in result.lower().split()

    def test_short_name_preserved(self) -> None:
        """Short merchant names should not be over-stripped."""
        result = extract_merchant_candidate("ATT PAYMENT")
        assert len(result) > 0

    def test_strips_trailing_numeric_tokens(self) -> None:
        result = extract_merchant_candidate("UBER EATS 8374829384")
        assert "8374829384" not in result

    def test_abbreviation_whse(self) -> None:
        result = extract_merchant_candidate("COSTCO WHSE")
        assert "warehouse" in result.lower()

    def test_abbreviation_mkt(self) -> None:
        result = extract_merchant_candidate("FARMERS MKT")
        assert "market" in result.lower()

    def test_abbreviation_intl(self) -> None:
        result = extract_merchant_candidate("INTL HOUSE OF PANCAKES")
        assert "international" in result.lower()

    def test_truncation_at_word_boundary(self) -> None:
        long_desc = "A" * 10 + " " + "B" * 10 + " " + "C" * 10 + " " + "D" * 10 + " " + "E" * 10
        result = extract_merchant_candidate(long_desc)
        assert len(result) <= 50  # Some slack for title-casing

    def test_comma_state_stripped(self) -> None:
        result = extract_merchant_candidate("MERCHANT NAME, CA")
        assert result.strip().lower() == "merchant name"
