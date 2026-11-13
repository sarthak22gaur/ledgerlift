import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type Client, type InValue } from "@libsql/client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFilters } from "@/lib/filters";
import { monthlyTransactionUrl } from "@/lib/monthly";
import { monthlyImportedScopeQuery, monthlySpendingQuery, transactionsQuery } from "@/server/data/queries";
import type { MonthlySpendingRow } from "@/server/data/types";

let client: Client;
let tempDirectory: string;
vi.mock("@/server/data/db", () => ({
  query: async (sql: string, params: InValue[] = []) => {
    const result = await client.execute({ sql, args: params });
    return result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index]])));
  },
}));
import { getMonthlyOverview } from "@/server/data/repository";

beforeAll(async () => {
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ledgerlift-monthly-test-"));
  client = createClient({ url: `file:${path.join(tempDirectory, "synthetic.sqlite")}` });
  await client.execute(`CREATE TABLE transactions (
    transaction_id TEXT PRIMARY KEY, transaction_date TEXT, institution TEXT, account_name TEXT,
    amount REAL, direction TEXT, category_normalized TEXT, merchant_normalized TEXT,
    subcategory_normalized TEXT, transfer_pair_id TEXT, is_transfer_candidate INTEGER DEFAULT 0,
    is_internal_payment_candidate INTEGER DEFAULT 0, description_raw TEXT DEFAULT 'Synthetic',
    description_normalized TEXT DEFAULT 'Synthetic'
  )`);
});
beforeEach(async () => { await client.execute("DELETE FROM transactions"); });
afterAll(() => {
  client.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

async function add(id: string, date: string, amount: number, category: string | null = "Groceries", options: { pair?: string; subcategory?: string; institution?: string; account?: string; merchant?: string } = {}) {
  await client.execute({
    sql: `INSERT INTO transactions (transaction_id, transaction_date, amount, direction, category_normalized, institution, account_name, merchant_normalized, transfer_pair_id, subcategory_normalized) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, date, amount, amount < 0 ? "debit" : "credit", category, options.institution ?? "bank", options.account ?? "checking", options.merchant ?? "Synthetic Store", options.pair ?? null, options.subcategory ?? null],
  });
}

describe("monthly SQL and repository over synthetic SQLite", () => {
  it("preserves debit spending and cashflow semantics for every relevant transaction class", async () => {
    await add("purchase", "2025-04-10", -100);
    await add("deposit", "2025-04-10", -500, "Security Deposit");
    await add("null", "2025-04-10", -40, null);
    await add("unclassified", "2025-04-10", -10, "Uncategorized");
    await add("reimbursement-out", "2025-04-10", -30, "Reimbursement");
    await add("reimbursement-in", "2025-04-10", 20, "Reimbursement");
    await add("refund", "2025-04-10", 15);
    await add("salary", "2025-04-10", 1000, "Income");
    await add("transfer", "2025-04-10", -70, "Transfers");
    await add("card-debit", "2025-04-10", -80, "Credit Card Payment");
    await add("orphan-card-credit", "2025-04-10", 80, "Credit Card Payment");
    await add("matched-out", "2025-04-10", -200, "Transfers", { pair: "pair" });
    await add("matched-in", "2025-04-10", 200, "Transfers", { pair: "pair" });
    await add("sweep", "2025-04-10", -300, "Transfers", { subcategory: "Internal Sweep" });
    await add("jan", "2025-01-10", -10);
    await add("feb", "2025-02-10", -20);
    await add("mar", "2025-03-10", -50);
    await add("newer", "2025-05-10", -1);
    await add("other-bank", "2025-04-10", -9999, "Groceries", { institution: "other" });
    await add("other-account", "2025-04-10", -8888, "Groceries", { account: "savings" });
    const data = await getMonthlyOverview("2025-04", { institutions: ["bank"], accounts: ["checking"], startDate: "1999-01-01", endDate: "1999-01-31" }, new Date(2025, 5, 1));
    expect(data.categorySpending).toBe(680);
    expect(data.metrics).toMatchObject({ totalIncome: 1015, totalExpenses: 810, netCashflow: 205, transferPairCount: 1, transferAmount: 200 });
    expect(data.transactionCount).toBe(14);
    expect(data.comparisonDay).toBeNull();
    expect(data.categories.reduce((sum, category) => sum + category.percentage, 0)).toBeCloseTo(100);
    expect(data.categories.find((row) => row.category === "Uncategorized")).toMatchObject({ amount: 50, count: 2 });
    expect(data.categories.find((row) => row.category === "Groceries")).toMatchObject({ amount: 100, previousAmount: 50, previousDifference: 50, previousPercent: 100, isNew: false });
    expect(data.categories.find((row) => row.category === "Groceries")?.threeMonthAverage).toBeCloseTo(80 / 3);
    expect(data.categories.find((row) => row.category === "Security Deposit")).toMatchObject({ previousAmount: 0, previousPercent: null, isNew: true });
    expect(data.merchants[0].amount).toBe(680);
    const drilldown = new URL(monthlyTransactionUrl(data.month, data.filters, { category: "Uncategorized" }), "https://example.test");
    const built = transactionsQuery(parseFilters(drilldown.searchParams));
    const rows = (await client.execute({ sql: built.sql, args: built.params as InValue[] })).rows;
    expect(rows.map((row) => row.transaction_id).sort()).toEqual(["null", "unclassified"]);
  });

  it("keeps actual totals distinct from current-month comparison cutoff and truncates shorter months", async () => {
    await add("may-early", "2025-05-10", -100);
    await add("may-future", "2025-05-20", -70);
    await add("april-early", "2025-04-10", -50);
    await add("april-late", "2025-04-20", -900);
    await add("march", "2025-03-10", -30);
    await add("february", "2025-02-10", -10);
    const data = await getMonthlyOverview("2025-05", {}, new Date(2025, 4, 12, 12));
    expect(data).toMatchObject({ categorySpending: 170, comparisonDay: 12, comparisonEndDate: "2025-05-12" });
    expect(data.categories[0]).toMatchObject({ amount: 170, comparisonAmount: 100, previousAmount: 50, threeMonthAverage: 30 });
    const latest = await getMonthlyOverview(null, {}, new Date(2025, 6, 1));
    expect(latest).toMatchObject({ month: "2025-05", comparisonDay: 20, comparisonEndDate: "2025-05-20" });
    await add("march-end", "2025-03-31", -10);
    await add("feb-end", "2025-02-28", -20);
    const march = await getMonthlyOverview("2025-03", {}, new Date(2025, 2, 31, 12));
    expect(march.comparisonDay).toBe(31);
    expect(march.categories[0].previousAmount).toBe(30);
  });

  it("suppresses absent baseline windows while treating absent categories in available windows as zero", async () => {
    await add("selected", "2025-04-05", -100, "Housing");
    await add("prior-credit", "2025-03-05", 1000, "Income");
    await add("old", "2025-01-05", -20, "Housing");
    const data = await getMonthlyOverview("2025-04", {}, new Date(2025, 5, 1));
    expect(data.categories[0]).toMatchObject({ previousAmount: 0, previousDifference: 100, previousPercent: null, threeMonthAverage: null, isNew: true });
    await client.execute("DELETE FROM transactions WHERE transaction_id = 'prior-credit'");
    const missing = await getMonthlyOverview("2025-04", {}, new Date(2025, 5, 1));
    expect(missing.categories[0]).toMatchObject({ previousAmount: null, previousDifference: null, previousPercent: null, threeMonthAverage: null, isNew: false });
  });

  it("defaults to scoped latest data and safely handles invalid or empty selections", async () => {
    await add("bank", "2025-02-12", -100);
    await add("other", "2025-09-10", -999, "Groceries", { institution: "other" });
    const now = new Date(2025, 10, 12, 12);
    const scoped = await getMonthlyOverview("2025-13", { institutions: ["bank"] }, now);
    expect(scoped).toMatchObject({ month: "2025-02", latestImportedDate: "2025-02-12", comparisonDay: 12 });
    const empty = await getMonthlyOverview(null, { institutions: ["absent"] }, now);
    expect(empty).toMatchObject({ month: "2025-11", latestImportedDate: null, transactionCount: 0, categorySpending: 0, categories: [] });
    const selectedEmpty = await getMonthlyOverview("2025-08", { institutions: ["bank"] }, now);
    expect(selectedEmpty).toMatchObject({ month: "2025-08", selectedLatestDate: null, transactionCount: 0, categorySpending: 0 });
    const built = monthlyImportedScopeQuery({ institutions: ["bank"] });
    expect((await client.execute({ sql: built.sql, args: built.params as InValue[] })).rows[0].latestDate).toBe("2025-02-12");
    const spending = monthlySpendingQuery({ startDate: "2025-03-01", endDate: "2025-03-31" });
    const rows = (await client.execute({ sql: spending.sql, args: spending.params as InValue[] })).rows as unknown as MonthlySpendingRow[];
    expect(rows[0]).toMatchObject({ importedCount: 0, amount: 0, count: 0, category: null });
  });
});
