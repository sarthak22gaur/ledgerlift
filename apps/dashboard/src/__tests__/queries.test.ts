import { describe, it, expect } from "vitest";
import {
  buildWhereClause,
  overviewMetricsQuery,
  cashflowSeriesQuery,
  categoryBreakdownQuery,
  topMerchantsQuery,
  transactionsQuery,
  transactionByIdQuery,
  unresolvedTransactionsQuery,
  transferCandidatesQuery,
  transferPairsQuery,
} from "@/server/data/queries";

const compactSql = (sql: string) => sql.replace(/\s+/g, " ").trim();

describe("buildWhereClause", () => {
  it("returns empty clause for no filters", () => {
    const { clause, params } = buildWhereClause({});
    expect(clause).toBe("");
    expect(params).toEqual([]);
  });

  it("builds date range clause", () => {
    const { clause, params } = buildWhereClause({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
    expect(clause).toContain("transaction_date >= ?");
    expect(clause).toContain("transaction_date <= ?");
    expect(params).toEqual(["2025-01-01", "2025-12-31"]);
  });

  it("builds institution IN clause", () => {
    const { clause, params } = buildWhereClause({
      institutions: ["chase", "capitalone"],
    });
    expect(clause).toContain("institution IN (?, ?)");
    expect(params).toEqual(["chase", "capitalone"]);
  });

  it("builds direction clause", () => {
    const { clause, params } = buildWhereClause({
      direction: "debit",
    });
    expect(clause).toContain("direction = ?");
    expect(params).toEqual(["debit"]);
  });

  it("builds amount range clauses", () => {
    const { clause, params } = buildWhereClause({
      minAmount: 10,
      maxAmount: 500,
    });
    expect(clause).toContain("ABS(amount) >= ?");
    expect(clause).toContain("ABS(amount) <= ?");
    expect(params).toEqual([10, 500]);
  });

  it("builds search clause with LOWER(...) LIKE LOWER(?)", () => {
    const { clause, params } = buildWhereClause({
      search: "coffee",
    });
    expect(clause).toContain("LOWER(description_raw) LIKE LOWER(?)");
    expect(clause).toContain("LOWER(description_normalized) LIKE LOWER(?)");
    expect(clause).toContain("LOWER(merchant_normalized) LIKE LOWER(?)");
    expect(params).toContain("%coffee%");
    expect(params.length).toBe(3); // description_raw, description_normalized, merchant_normalized
  });

  it("builds uncategorized clause", () => {
    const { clause } = buildWhereClause({
      uncategorizedOnly: true,
    });
    expect(clause).toContain("category_normalized IS NULL");
    expect(clause).toContain("Uncategorized");
  });

  it("builds transfer candidates clause", () => {
    const { clause } = buildWhereClause({
      transferCandidatesOnly: true,
    });
    expect(clause).toContain("is_transfer_candidate");
    expect(clause).toContain("is_internal_payment_candidate");
  });

  it("combines multiple filters with AND", () => {
    const { clause } = buildWhereClause({
      startDate: "2025-01-01",
      direction: "debit",
      search: "test",
    });
    expect(clause).toContain("AND");
    expect(clause.startsWith("WHERE")).toBe(true);
  });
});

describe("overviewMetricsQuery", () => {
  it("returns valid SQL with aliases", () => {
    const { sql } = overviewMetricsQuery({});
    expect(sql).toContain("totalIncome");
    expect(sql).toContain("totalExpenses");
    expect(sql).toContain("netCashflow");
    expect(sql).toContain("uncategorizedSpend");
    expect(sql).toContain("transactionCount");
    expect(sql).toContain("FROM transactions");
  });

  it("excludes unpaired credit-card payment credits from income only", () => {
    const { sql } = overviewMetricsQuery({});
    const compact = compactSql(sql);
    expect(compact).toContain(
      "CASE WHEN amount > 0 AND NOT (category_normalized = 'Credit Card Payment' AND amount > 0 AND transfer_pair_id IS NULL) AND NOT (COALESCE(category_normalized, '') = 'Reimbursement' AND amount > 0) THEN amount ELSE 0 END"
    );
    expect(compact).toContain(
      "CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END"
    );
    expect(compact).not.toContain(
      "CASE WHEN amount < 0 AND NOT (category_normalized = 'Credit Card Payment'"
    );
  });

  it("counts transfer amount once per matched pair", () => {
    const { sql } = overviewMetricsQuery({});
    const compact = compactSql(sql);
    expect(compact).toContain(
      "ROW_NUMBER() OVER (PARTITION BY transfer_pair_id ORDER BY direction DESC, transaction_date) AS rn"
    );
    expect(compact).toContain("WHERE rn = 1 AND pair_row_count >= 2");
    expect(compact).not.toContain('SUM(ABS(amount)), 0) AS "transferAmount"');
  });
});

describe("cashflowSeriesQuery", () => {
  it("groups by month", () => {
    const { sql } = cashflowSeriesQuery({});
    expect(sql).toContain("GROUP BY month");
    expect(sql).toContain("ORDER BY month");
  });

  it("excludes unpaired credit-card payment credits from income only", () => {
    const { sql } = cashflowSeriesQuery({});
    const compact = compactSql(sql);
    expect(compact).toContain(
      "CASE WHEN amount > 0 AND NOT (category_normalized = 'Credit Card Payment' AND amount > 0 AND transfer_pair_id IS NULL) AND NOT (COALESCE(category_normalized, '') = 'Reimbursement' AND amount > 0) THEN amount ELSE 0 END"
    );
    expect(compact).toContain(
      "CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END"
    );
    expect(compact).not.toContain(
      "CASE WHEN amount < 0 AND NOT (category_normalized = 'Credit Card Payment'"
    );
  });
});

describe("categoryBreakdownQuery", () => {
  it("filters expenses only", () => {
    const { sql } = categoryBreakdownQuery({});
    expect(sql).toContain("amount < 0");
  });
});

describe("topMerchantsQuery", () => {
  it("uses LIMIT parameter", () => {
    const { sql, params } = topMerchantsQuery({}, 20);
    expect(sql).toContain("LIMIT ?");
    expect(params).toContain(20);
  });
});

describe("transactionsQuery", () => {
  it("uses pagination", () => {
    const { sql, params } = transactionsQuery({}, 2, 25);
    expect(sql).toContain("LIMIT ?");
    expect(sql).toContain("OFFSET ?");
    expect(params).toContain(25); // pageSize
    expect(params).toContain(25); // offset = (2-1) * 25
  });

  it("sanitizes sort column", () => {
    const { sql } = transactionsQuery({}, 1, 50, "DROP TABLE", "desc");
    expect(sql).toContain("ORDER BY transaction_date"); // falls back to default
    expect(sql).not.toContain("DROP TABLE");
  });

  it("sanitizes sort direction", () => {
    const { sql } = transactionsQuery(
      {},
      1,
      50,
      "transaction_date",
      "asc"
    );
    expect(sql).toContain("ASC");
  });
});

describe("transactionByIdQuery", () => {
  it("uses parameterized ID", () => {
    const { sql, params } = transactionByIdQuery("abc123");
    expect(sql).toContain("transaction_id = ?");
    expect(params).toEqual(["abc123"]);
  });
});

describe("unresolvedTransactionsQuery", () => {
  it("forces uncategorized filter", () => {
    const { sql } = unresolvedTransactionsQuery({});
    expect(sql).toContain("category_normalized IS NULL");
  });
});

describe("transferCandidatesQuery", () => {
  it("forces transfer candidate filter", () => {
    const { sql } = transferCandidatesQuery({});
    expect(sql).toContain("is_transfer_candidate");
  });
});

describe("transferPairsQuery", () => {
  it("orders debit leg first for pair display", () => {
    const { sql } = transferPairsQuery({});
    const compact = compactSql(sql);
    expect(compact).toContain(
      "ROW_NUMBER() OVER (PARTITION BY transfer_pair_id ORDER BY direction DESC, transaction_date) AS rn"
    );
  });
});
