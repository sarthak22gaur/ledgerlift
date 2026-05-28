import { describe, it, expect } from "vitest";
import { filterSchema, transactionSchema } from "@/lib/schemas";

describe("filterSchema", () => {
  it("accepts empty object", () => {
    const result = filterSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts valid date strings", () => {
    const result = filterSchema.safeParse({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBe("2025-01-01");
      expect(result.data.endDate).toBe("2025-12-31");
    }
  });

  it("accepts valid institution arrays", () => {
    const result = filterSchema.safeParse({
      institutions: ["chase", "capitalone"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.institutions).toEqual(["chase", "capitalone"]);
    }
  });

  it("accepts valid direction enum", () => {
    expect(filterSchema.safeParse({ direction: "debit" }).success).toBe(true);
    expect(filterSchema.safeParse({ direction: "credit" }).success).toBe(true);
  });

  it("rejects invalid direction", () => {
    const result = filterSchema.safeParse({ direction: "invalid" });
    expect(result.success).toBe(false);
  });

  it("coerces string amounts to numbers", () => {
    const result = filterSchema.safeParse({
      minAmount: "50",
      maxAmount: "1000",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minAmount).toBe(50);
      expect(result.data.maxAmount).toBe(1000);
    }
  });

  it("rejects negative amounts", () => {
    const result = filterSchema.safeParse({ minAmount: -10 });
    expect(result.success).toBe(false);
  });

  it("coerces boolean values", () => {
    const result = filterSchema.safeParse({
      uncategorizedOnly: true,
      transferCandidatesOnly: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.uncategorizedOnly).toBe(true);
      expect(result.data.transferCandidatesOnly).toBe(false);
    }
  });
});

describe("transactionSchema", () => {
  const validTransaction = {
    transaction_id: "abc123",
    source_file_hash: "hash123",
    institution: "chase",
    account_name: "checking",
    account_type: "checking",
    statement_start_date: "2025-01-01",
    statement_end_date: "2025-01-31",
    transaction_date: "2025-01-15",
    posted_date: "2025-01-15",
    description_raw: "AMAZON.COM",
    description_normalized: "amazon.com",
    amount: -49.99,
    currency: "USD",
    direction: "debit",
    transaction_type: "purchase",
    category_raw: null,
    category_normalized: "Shopping",
    subcategory_normalized: null,
    merchant_normalized: "Amazon",
    merchant_confidence: 0.95,
    merchant_rule_id: "merchant-1",
    category_confidence: 0.9,
    category_rule_id: "cat-1",
    reference_number: null,
    is_transfer_candidate: false,
    is_internal_payment_candidate: false,
    parser_name: "chase_checking_pdf",
    parser_version: "0.3.0",
    import_timestamp: "2025-01-20T10:00:00",
    enriched_at: "2025-01-20T10:01:00",
  };

  it("accepts a valid transaction", () => {
    const result = transactionSchema.safeParse(validTransaction);
    expect(result.success).toBe(true);
  });

  it("accepts all transaction types", () => {
    const types = [
      "purchase", "ach", "fee", "interest", "check",
      "transfer", "atm", "deposit", "withdrawal", "payment", "unknown",
    ];
    for (const type of types) {
      const result = transactionSchema.safeParse({
        ...validTransaction,
        transaction_type: type,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid transaction type", () => {
    const result = transactionSchema.safeParse({
      ...validTransaction,
      transaction_type: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("accepts nullable fields as null", () => {
    const result = transactionSchema.safeParse({
      ...validTransaction,
      category_raw: null,
      merchant_normalized: null,
      enriched_at: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const incomplete: Record<string, unknown> = { ...validTransaction };
    delete incomplete.transaction_id;
    const result = transactionSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });
});
