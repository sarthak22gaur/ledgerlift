import { describe, expect, it } from "vitest";
import { categoryReviewOverrideId, detectCategorizationReview } from "@/lib/categorization-review";
import type { Transaction } from "@/server/data/types";

function transaction(id: string, options: Partial<Transaction> = {}): Transaction {
  return {
    transaction_id: id, transaction_date: "2025-04-01", description_raw: "Costco Whse synthetic",
    amount: -100, currency: "USD", direction: "debit", merchant_normalized: "Costco",
    merchant_rule_id: "costco", category_rule_id: "costco", category_confidence: 0.9,
    category_normalized: "Groceries", ...options,
  } as Transaction;
}

describe("categorization review detector", () => {
  it("flags high-confidence mixed merchant defaults, but not substring merchants or independent category assignments", () => {
    const rows = [transaction("costco"), transaction("amazon", { merchant_normalized: "Amazon", merchant_rule_id: "amazon", category_rule_id: "amazon" }),
      transaction("substring", { merchant_normalized: "Costco Gas" }), transaction("independent", { category_rule_id: "specific-category" }),
      transaction("ordinary", { merchant_normalized: "Ordinary" }), transaction("missing", { category_normalized: null }),
      transaction("uncategorized", { category_normalized: "Uncategorized" })];
    expect(detectCategorizationReview(rows, []).data.map((row) => row.transaction_id)).toEqual(["amazon", "costco"]);
    expect(detectCategorizationReview([rows[0]], []).data[0].reviewReasons).toEqual([{ kind: "mixed-retailer", label: expect.any(String) }]);
  });

  it("detects fuzzy, type and low-confidence categories independently and leaves null confidence alone", () => {
    const rows = [transaction("fuzzy", { category_rule_id: "fuzzy:store", category_confidence: 0.95 }),
      transaction("type", { category_rule_id: "type:atm", category_confidence: 0.9 }),
      transaction("low", { category_rule_id: "source:unknown", category_confidence: 0.79 }),
      transaction("null", { category_rule_id: "source:known", category_confidence: null }),
      transaction("boundary", { category_rule_id: "source:known", category_confidence: 0.8 })];
    expect(detectCategorizationReview(rows, []).data.map((row) => row.transaction_id)).toEqual(["fuzzy", "low", "type"]);
  });

  it("excludes applied and pending manual categories using exact identity before raw-description patterns", () => {
    const rows = [transaction("applied", { category_rule_id: "override:old" }), transaction("exact"),
      transaction("pattern"), transaction("merchant-only", { description_raw: "Other" }),
      transaction("wrong-id", { description_raw: "Unmatched" }), transaction("raw", { description_raw: "COSTCO raw", description_normalized: "different" })];
    const overrides = [
      { id: "exact", transaction_id: "exact", category: "Groceries" },
      { id: "pattern", pattern: "(?i)^COSTCO", category: "Shopping" },
      { id: "merchant-only", transaction_id: "merchant-only", merchant: "Other" },
      { id: "wrong-id", transaction_id: "not-this-id", pattern: "Unmatched", category: "Shopping" },
      { id: "no-match", pattern: "^NOT-COSTCO", category: "Shopping" },
    ];
    expect(detectCategorizationReview(rows, [], overrides).data.map((row) => row.transaction_id)).toEqual(["merchant-only", "wrong-id"]);
  });

  it("requires five other merchant samples, excludes itself and separates currency and direction", () => {
    const candidate = transaction("large", { merchant_normalized: "Ordinary", amount: -300 });
    const peers = Array.from({ length: 5 }, (_, index) => transaction(`peer-${index}`, { merchant_normalized: "Ordinary", amount: -100 }));
    expect(detectCategorizationReview([candidate], [candidate, ...peers.slice(0, 4)]).total).toBe(0);
    const reason = detectCategorizationReview([candidate], [candidate, ...peers]).data[0].reviewReasons[0];
    expect(reason).toMatchObject({ kind: "unusual-amount", baseline: "merchant", ratio: 3, median: 100, sampleCount: 5, currency: "USD" });
    expect(detectCategorizationReview([candidate], [candidate, ...peers.map((row) => ({ ...row, currency: "EUR" }))]).total).toBe(0);
    expect(detectCategorizationReview([candidate], [candidate, ...peers.map((row) => ({ ...row, direction: "credit" as const }))]).total).toBe(0);
    expect(detectCategorizationReview([candidate], peers.map((row) => ({ ...row, amount: 0 }))).total).toBe(0);
  });

  it("requires ten other category peers and uses the even median after self exclusion", () => {
    const candidate = transaction("large", { merchant_normalized: "Uncommon", amount: -1000 });
    const peers = Array.from({ length: 10 }, (_, index) => transaction(`peer-${index}`, { merchant_normalized: `Store-${index}`, amount: index < 5 ? -100 : -300 }));
    expect(detectCategorizationReview([candidate], [candidate, ...peers.slice(0, 9)]).total).toBe(0);
    expect(detectCategorizationReview([candidate], [candidate, ...peers]).data[0].reviewReasons[0]).toMatchObject({ baseline: "category", ratio: 5, median: 200, sampleCount: 10 });
  });

  it("ranks all candidates before pagination with one distinct amount signal, stable ties and clamped pages", () => {
    const rows = Array.from({ length: 55 }, (_, index) => transaction(`id-${String(index).padStart(2, "0")}`, { amount: -(index + 1) }));
    const strongest = transaction("strong", { amount: -500, category_confidence: 0.5 });
    const euro = transaction("eur", { currency: "EUR", amount: -999 });
    const first = detectCategorizationReview([...rows, strongest, euro], [], [], 1);
    const second = detectCategorizationReview([...rows, strongest, euro], [], [], 2);
    expect(first.total).toBe(57);
    expect(first.data.slice(0, 3).map((row) => row.transaction_id)).toEqual(["strong", "eur", "id-54"]);
    expect(second.data.map((row) => row.transaction_id)).toEqual(["id-06", "id-05", "id-04", "id-03", "id-02", "id-01", "id-00"]);
    expect(new Set([...first.data, ...second.data].map((row) => row.transaction_id)).size).toBe(57);
    expect(detectCategorizationReview(rows.slice(0, 50), [], [], 2).page).toBe(1);
    const ties = [transaction("b"), transaction("a"), transaction("new", { transaction_date: "2025-04-02" })];
    expect(detectCategorizationReview(ties, []).data.map((row) => row.transaction_id)).toEqual(["new", "a", "b"]);
    const multi = transaction("all", { category_confidence: 0.4, amount: -500 });
    const peers = Array.from({ length: 10 }, (_, index) => transaction(`peer-${index}`, { amount: -50 }));
    expect(detectCategorizationReview([multi], [multi, ...peers]).data[0].reviewReasons.map((reason) => reason.kind)).toEqual(["mixed-retailer", "weak-mapping", "unusual-amount"]);
  });

  it("preserves complete transaction identity in independent and repeat action IDs", () => {
    expect(categoryReviewOverrideId("same/prefix:one")).toBe("category-review:same/prefix:one");
    expect(categoryReviewOverrideId("same/prefix:one")).toBe(categoryReviewOverrideId("same/prefix:one"));
    expect(categoryReviewOverrideId("same/prefix:one")).not.toBe(categoryReviewOverrideId("same/prefix:two"));
  });
});
