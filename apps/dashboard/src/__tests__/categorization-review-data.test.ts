import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client, type InValue } from "@libsql/client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Transaction } from "@/server/data/types";

let client: Client;
let tempDirectory: string;
vi.mock("@/server/data/db", () => ({
  query: async (sql: string, params: InValue[] = []) => {
    const result = await client.execute({ sql, args: params });
    return result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index]])));
  },
}));
import { getCategorizationReview } from "@/server/data/repository";
import { upsertCategoryOverride, upsertMerchantOverride } from "@/server/rules/repository";

beforeAll(async () => {
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ledgerlift-category-review-"));
  client = createClient({ url: `file:${path.join(tempDirectory, "synthetic.sqlite")}` });
  await client.executeMultiple(`CREATE TABLE transactions (
    transaction_id TEXT PRIMARY KEY, transaction_date TEXT, institution TEXT, account_name TEXT,
    amount REAL, currency TEXT, direction TEXT, category_normalized TEXT, merchant_normalized TEXT,
    subcategory_normalized TEXT, transfer_pair_id TEXT, is_transfer_candidate INTEGER DEFAULT 0,
    is_internal_payment_candidate INTEGER DEFAULT 0, description_raw TEXT,
    description_normalized TEXT, category_rule_id TEXT, merchant_rule_id TEXT, category_confidence REAL
  );
  CREATE TABLE category_overrides (id TEXT PRIMARY KEY, transaction_id TEXT, pattern TEXT, merchant TEXT, category TEXT, subcategory TEXT);
  CREATE TABLE merchant_overrides (id TEXT PRIMARY KEY, transaction_id TEXT, pattern TEXT, merchant TEXT, category TEXT, subcategory TEXT);
  CREATE TABLE pipeline_meta (key TEXT PRIMARY KEY, value TEXT);`);
});
beforeEach(async () => {
  await client.executeMultiple("DELETE FROM transactions; DELETE FROM category_overrides; DELETE FROM merchant_overrides; DELETE FROM pipeline_meta;");
});
afterAll(() => {
  client.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

async function add(id: string, options: Partial<Transaction> = {}) {
  const row = {
    transaction_id: id, transaction_date: "2025-04-01", institution: "bank", account_name: "checking",
    amount: -100, currency: "USD", direction: "debit", category_normalized: "Groceries",
    merchant_normalized: "Costco", subcategory_normalized: null, transfer_pair_id: null,
    description_raw: "Costco Whse synthetic", description_normalized: "costco whse synthetic",
    category_rule_id: "costco", merchant_rule_id: "costco", category_confidence: 0.9, ...options,
  };
  await client.execute({ sql: `INSERT INTO transactions (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map(() => "?").join(", ")})`, args: Object.values(row) as InValue[] });
}

describe("categorization review over temporary synthetic SQLite", () => {
  it("preserves externally assigned Transfers for review while excluding internal and uncategorized rows", async () => {
    await add("high-confidence-costco");
    await add("external-transfer", { category_normalized: "Transfers", category_rule_id: "type:transfer", category_confidence: 0.7 });
    await add("paired", { transfer_pair_id: "pair" });
    await add("sweep", { subcategory_normalized: "Internal Sweep" });
    await add("null", { category_normalized: null });
    await add("uncategorized", { category_normalized: "Uncategorized" });
    await add("ordinary", { merchant_normalized: "Ordinary" });
    const result = await getCategorizationReview({});
    expect(result.data.map((row) => row.transaction_id)).toEqual(["external-transfer", "high-confidence-costco"]);
    expect((await getCategorizationReview({ uncategorizedOnly: true })).total).toBe(0);
  });

  it("excludes pending exact/pattern overrides from both tables while merchant-only changes stay eligible", async () => {
    await add("applied", { category_rule_id: "override:existing" });
    await add("exact");
    await add("pattern", { description_raw: "cOsTcO PATTERN" });
    await add("merchant-category", { description_raw: "manual merchant category" });
    await add("merchant-pattern", { description_raw: "merchant pattern synthetic" });
    await add("merchant-only", { description_raw: "merchant only synthetic" });
    await add("nonmatching", { description_raw: "unmatched synthetic" });
    await upsertCategoryOverride({ id: "confirm-exact", transaction_id: "exact", category: "Groceries" });
    await upsertCategoryOverride({ id: "confirm-pattern", pattern: "(?i)^COSTCO PATTERN$", category: "Groceries" });
    await upsertCategoryOverride({ id: "wrong-id", transaction_id: "absent", pattern: "unmatched", category: "Groceries" });
    await upsertMerchantOverride({ id: "merchant-category", transaction_id: "merchant-category", merchant: "New", category: "Shopping" });
    await upsertMerchantOverride({ id: "merchant-pattern", pattern: "^MERCHANT PATTERN", category: "Shopping" });
    await upsertMerchantOverride({ id: "merchant-only", transaction_id: "merchant-only", merchant: "New" });
    const result = await getCategorizationReview({});
    expect(result.data.map((row) => row.transaction_id)).toEqual(["merchant-only", "nonmatching"]);
    // Independent writes remain available while the existing dirty marker is set.
    await upsertCategoryOverride({ id: "category-review:merchant-only", transaction_id: "merchant-only", category: "Groceries" });
    expect((await getCategorizationReview({})).data.map((row) => row.transaction_id)).toEqual(["nonmatching"]);
  });

  it("uses full scoped history for cohorts despite display date/search/category/merchant/amount filters", async () => {
    await add("candidate", { merchant_normalized: "Ordinary", category_rule_id: "specific", amount: -300, description_raw: "needle synthetic" });
    for (let index = 0; index < 5; index++) {
      await add(`peer-${index}`, { merchant_normalized: "Ordinary", category_normalized: "Other", amount: -100, transaction_date: "2023-01-01", description_raw: "baseline synthetic" });
      await add(`outside-bank-${index}`, { institution: "other", merchant_normalized: "Ordinary", amount: -10000 });
      await add(`outside-account-${index}`, { account_name: "savings", merchant_normalized: "Ordinary", amount: -10000 });
      await add(`opposite-${index}`, { direction: "credit", amount: 10000, merchant_normalized: "Ordinary" });
      await add(`foreign-${index}`, { currency: "EUR", amount: -10000, merchant_normalized: "Ordinary" });
    }
    const filters = { institutions: ["bank"], accounts: ["checking"], startDate: "2025-04-01", endDate: "2025-04-01", search: "needle", categories: ["Groceries"], merchants: ["Ordinary"], minAmount: 250, maxAmount: 350 };
    const result = await getCategorizationReview(filters);
    expect(result.total).toBe(1);
    expect(result.data[0].reviewReasons).toEqual([expect.objectContaining({ kind: "unusual-amount", ratio: 3, median: 100, sampleCount: 5 })]);
    expect((await getCategorizationReview({ ...filters, search: "absent" })).total).toBe(0);
    expect((await getCategorizationReview({ ...filters, accounts: ["absent"] })).total).toBe(0);
  });

  it("keeps internal, zero and uncategorized rows out of comparison sample counts", async () => {
    await add("candidate", { merchant_normalized: "Ordinary", category_rule_id: "specific", amount: -300 });
    for (let index = 0; index < 4; index++) await add(`peer-${index}`, { merchant_normalized: "Ordinary" });
    await add("paired-peer", { merchant_normalized: "Ordinary", transfer_pair_id: "pair" });
    await add("sweep-peer", { merchant_normalized: "Ordinary", subcategory_normalized: "Internal Sweep" });
    await add("zero-peer", { merchant_normalized: "Ordinary", amount: 0 });
    await add("uncategorized-peer", { merchant_normalized: "Ordinary", category_normalized: "Uncategorized" });
    await add("null-peer", { merchant_normalized: "Ordinary", category_normalized: null });
    expect((await getCategorizationReview({ merchants: ["Ordinary"] })).total).toBe(0);
  });

  it("ranks the complete filtered candidate set before 50-row pagination and returns load failures", async () => {
    for (let index = 0; index < 55; index++) await add(`item-${String(index).padStart(2, "0")}`, { amount: -(index + 1) });
    await add("strong", { category_confidence: 0.7, amount: -1 });
    const first = await getCategorizationReview({}, 1);
    const second = await getCategorizationReview({}, 2);
    expect(first.total).toBe(56);
    expect(first.data[0].transaction_id).toBe("strong");
    expect(first.data).toHaveLength(50);
    expect(second.data.map((row) => row.transaction_id)).toEqual(["item-05", "item-04", "item-03", "item-02", "item-01", "item-00"]);
    await client.execute("DROP TABLE transactions");
    await expect(getCategorizationReview({})).rejects.toThrow();
  });
});
