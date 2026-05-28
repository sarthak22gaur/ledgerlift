import { describe, it, expect } from "vitest";
import {
  parseFilters,
  filtersToSearchParams,
  getActiveFilterCount,
  isDefaultFilters,
} from "@/lib/filters";

describe("parseFilters", () => {
  it("returns empty object for empty params", () => {
    const params = new URLSearchParams();
    const result = parseFilters(params);
    expect(result).toEqual({});
  });

  it("parses date filters", () => {
    const params = new URLSearchParams({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
    const result = parseFilters(params);
    expect(result.startDate).toBe("2025-01-01");
    expect(result.endDate).toBe("2025-12-31");
  });

  it("parses comma-separated arrays", () => {
    const params = new URLSearchParams({
      institutions: "chase,capitalone",
      categories: "Groceries,Dining",
    });
    const result = parseFilters(params);
    expect(result.institutions).toEqual(["chase", "capitalone"]);
    expect(result.categories).toEqual(["Groceries", "Dining"]);
  });

  it("parses direction filter", () => {
    const params = new URLSearchParams({ direction: "debit" });
    const result = parseFilters(params);
    expect(result.direction).toBe("debit");
  });

  it("parses numeric amount filters", () => {
    const params = new URLSearchParams({
      minAmount: "10",
      maxAmount: "500",
    });
    const result = parseFilters(params);
    expect(result.minAmount).toBe(10);
    expect(result.maxAmount).toBe(500);
  });

  it("parses boolean filters", () => {
    const params = new URLSearchParams({
      uncategorizedOnly: "true",
      transferCandidatesOnly: "1",
    });
    const result = parseFilters(params);
    expect(result.uncategorizedOnly).toBe(true);
    expect(result.transferCandidatesOnly).toBe(true);
  });

  it("parses search filter", () => {
    const params = new URLSearchParams({ search: "coffee" });
    const result = parseFilters(params);
    expect(result.search).toBe("coffee");
  });

  it("ignores invalid direction values", () => {
    const params = new URLSearchParams({ direction: "invalid" });
    const result = parseFilters(params);
    expect(result).toEqual({});
  });

  it("ignores negative amount values", () => {
    const params = new URLSearchParams({ minAmount: "-10" });
    const result = parseFilters(params);
    expect(result).toEqual({});
  });
});

describe("filtersToSearchParams", () => {
  it("returns empty params for empty filters", () => {
    const params = filtersToSearchParams({});
    expect(params.toString()).toBe("");
  });

  it("serializes all filter types", () => {
    const params = filtersToSearchParams({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      institutions: ["chase"],
      direction: "debit",
      minAmount: 50,
      search: "test",
      uncategorizedOnly: true,
    });
    expect(params.get("startDate")).toBe("2025-01-01");
    expect(params.get("endDate")).toBe("2025-12-31");
    expect(params.get("institutions")).toBe("chase");
    expect(params.get("direction")).toBe("debit");
    expect(params.get("minAmount")).toBe("50");
    expect(params.get("search")).toBe("test");
    expect(params.get("uncategorizedOnly")).toBe("true");
  });

  it("joins array values with commas", () => {
    const params = filtersToSearchParams({
      categories: ["Groceries", "Dining"],
    });
    expect(params.get("categories")).toBe("Groceries,Dining");
  });

  it("omits empty arrays", () => {
    const params = filtersToSearchParams({
      institutions: [],
    });
    expect(params.has("institutions")).toBe(false);
  });
});

describe("getActiveFilterCount", () => {
  it("returns 0 for no filters", () => {
    expect(getActiveFilterCount({})).toBe(0);
  });

  it("counts each active filter", () => {
    expect(
      getActiveFilterCount({
        startDate: "2025-01-01",
        direction: "debit",
        search: "test",
      })
    ).toBe(3);
  });

  it("counts arrays as one filter each", () => {
    expect(
      getActiveFilterCount({
        institutions: ["chase", "capitalone"],
        categories: ["Groceries"],
      })
    ).toBe(2);
  });
});

describe("isDefaultFilters", () => {
  it("returns true for empty filters", () => {
    expect(isDefaultFilters({})).toBe(true);
  });

  it("returns false when any filter is set", () => {
    expect(isDefaultFilters({ search: "test" })).toBe(false);
  });
});

describe("round-trip: parse -> serialize -> parse", () => {
  it("preserves filters through serialization", () => {
    const original = {
      startDate: "2025-01-01",
      endDate: "2025-06-30",
      institutions: ["chase"],
      categories: ["Groceries", "Dining"],
      direction: "debit" as const,
      minAmount: 10,
      maxAmount: 500,
      search: "coffee",
    };
    const serialized = filtersToSearchParams(original);
    const parsed = parseFilters(serialized);

    expect(parsed.startDate).toBe(original.startDate);
    expect(parsed.endDate).toBe(original.endDate);
    expect(parsed.institutions).toEqual(original.institutions);
    expect(parsed.categories).toEqual(original.categories);
    expect(parsed.direction).toBe(original.direction);
    expect(parsed.minAmount).toBe(original.minAmount);
    expect(parsed.maxAmount).toBe(original.maxAmount);
    expect(parsed.search).toBe(original.search);
  });
});
