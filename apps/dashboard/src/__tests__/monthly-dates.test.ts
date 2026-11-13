import { describe, expect, it } from "vitest";
import { comparisonDayForMonth, monthRange, monthlyTransactionUrl, monthlyUrl, parseMonth, parseMonthlyFilters, shiftMonth } from "@/lib/monthly";

describe("monthly dates and URL scope", () => {
  it("validates calendar months and rolls over year boundaries", () => {
    for (const value of ["2025-00", "2025-13", "2025-2", "bad", "2025-02-01", null]) expect(parseMonth(value)).toBeNull();
    expect(parseMonth("2024-02")).toBe("2024-02");
    expect(shiftMonth("2025-01", -1)).toBe("2024-12");
    expect(shiftMonth("2024-12", 1)).toBe("2025-01");
    expect(monthRange("2024-02")).toEqual({ startDate: "2024-02-01", endDate: "2024-02-29" });
    expect(monthRange("2025-02", 31).endDate).toBe("2025-02-28");
  });

  it("aligns the current and latest imported months without claiming completeness", () => {
    const now = new Date(2025, 4, 12, 12);
    expect(comparisonDayForMonth("2025-05", "2025-05-20", "2025-05-20", now)).toBe(12);
    expect(comparisonDayForMonth("2025-05", "2025-05-08", "2025-05-08", now)).toBe(8);
    expect(comparisonDayForMonth("2025-02", "2025-02-20", "2025-02-20", now)).toBe(20);
    expect(comparisonDayForMonth("2025-02", "2025-03-01", "2025-02-20", now)).toBeNull();
    expect(comparisonDayForMonth("2025-02", "2025-02-28", "2025-02-28", now)).toBeNull();
  });

  it("replaces stale dates and retains valid non-date dimensions", () => {
    const filters = parseMonthlyFilters(new URLSearchParams("startDate=nonsense&endDate=2020-01-01&institutions=bank&accounts=checking&direction=invalid&minAmount=-2&search=coffee"));
    expect(filters).toEqual({ institutions: ["bank"], accounts: ["checking"], search: "coffee" });
    const url = new URL(monthlyUrl("2025-02", { ...filters, startDate: "2020-01-01", endDate: "2020-01-31" }), "https://example.test");
    expect(url.searchParams.get("month")).toBe("2025-02");
    expect(url.searchParams.has("startDate")).toBe(false);
    expect(url.searchParams.get("accounts")).toBe("checking");
  });

  it("drills categories into debit rows, representing NULL through the existing uncategorized filter", () => {
    const filters = { institutions: ["bank"], accounts: ["checking"], categories: ["Old"], merchants: ["Store"], direction: "credit" as const, uncategorizedOnly: true, startDate: "1999-01-01" };
    const category = new URL(monthlyTransactionUrl("2024-02", filters, { category: "Housing" }), "https://example.test").searchParams;
    expect(category.get("categories")).toBe("Housing");
    expect(category.get("direction")).toBe("debit");
    expect(category.has("uncategorizedOnly")).toBe(false);
    expect(category.get("endDate")).toBe("2024-02-29");
    expect(category.get("institutions")).toBe("bank");
    expect(category.get("accounts")).toBe("checking");
    expect(category.get("merchants")).toBe("Store");
    const uncategorized = new URL(monthlyTransactionUrl("2025-03", filters, { category: "Uncategorized" }), "https://example.test").searchParams;
    expect(uncategorized.has("categories")).toBe(false);
    expect(uncategorized.get("uncategorizedOnly")).toBe("true");
    const merchant = new URL(monthlyTransactionUrl("2025-03", filters, { merchant: "New Store" }), "https://example.test").searchParams;
    expect(merchant.get("merchants")).toBe("New Store");
    expect(merchant.get("categories")).toBe("Old");
    expect(merchant.get("direction")).toBe("debit");
  });
});
