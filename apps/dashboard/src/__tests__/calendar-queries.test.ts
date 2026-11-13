import { describe, it, expect } from "vitest";
import {
  calendarYearSeriesQuery,
  calendarMonthSeriesQuery,
  calendarYearHeatmapQuery,
  calendarDayHeatmapQuery,
  dayOfWeekSeriesQuery,
  seasonSeriesQuery,
  monthOfYearSeriesQuery,
} from "@/server/data/queries";

const compactSql = (sql: string) => sql.replace(/\s+/g, " ").trim();

const NOT_INTERNAL_FLOW_FRAGMENT = "transfer_pair_id IS NULL";

describe("calendarYearSeriesQuery", () => {
  it("groups by strftime('%Y')", () => {
    const { sql } = calendarYearSeriesQuery({}, "expenses");
    expect(sql).toContain("strftime('%Y', transaction_date)");
    expect(sql).toContain("GROUP BY");
    expect(sql).toContain("ORDER BY year");
  });

  it("selects year and value", () => {
    const { sql } = calendarYearSeriesQuery({}, "expenses");
    expect(sql).toContain("AS year");
    expect(sql).toContain("AS value");
  });

  it("applies NOT_INTERNAL_FLOW predicate", () => {
    const { sql } = calendarYearSeriesQuery({}, "expenses");
    expect(sql).toContain(NOT_INTERNAL_FLOW_FRAGMENT);
  });

  it("expenses metric uses ABS(amount) expression", () => {
    const { sql } = calendarYearSeriesQuery({}, "expenses");
    expect(sql).toContain("ABS(amount)");
  });

  it("net metric differs from expenses metric", () => {
    const expensesSql = calendarYearSeriesQuery({}, "expenses").sql;
    const netSql = calendarYearSeriesQuery({}, "net").sql;
    expect(expensesSql).not.toEqual(netSql);
    expect(netSql).toContain("SUM(CASE WHEN amount > 0");
  });

  it("filter params precede any year/month params — no extra params for whole-dataset builder", () => {
    const filters = { startDate: "2024-01-01", institutions: ["chase"] };
    const { params } = calendarYearSeriesQuery(filters, "expenses");
    expect(params[0]).toBe("2024-01-01");
    expect(params[1]).toBe("chase");
  });

  it("returns empty params for empty filters", () => {
    const { params } = calendarYearSeriesQuery({}, "expenses");
    expect(params).toEqual([]);
  });
});

describe("calendarMonthSeriesQuery", () => {
  it("groups by strftime('%m')", () => {
    const { sql } = calendarMonthSeriesQuery({}, "expenses", "2024");
    expect(sql).toContain("strftime('%m', transaction_date)");
    expect(sql).toContain("GROUP BY");
    expect(sql).toContain("ORDER BY month");
  });

  it("filters by year param appended after filter params", () => {
    const filters = { startDate: "2023-01-01" };
    const { params } = calendarMonthSeriesQuery(filters, "expenses", "2024");
    expect(params[0]).toBe("2023-01-01");
    expect(params[params.length - 1]).toBe("2024");
  });

  it("year param is last when no filters", () => {
    const { params } = calendarMonthSeriesQuery({}, "expenses", "2024");
    expect(params).toEqual(["2024"]);
  });

  it("SQL contains strftime('%Y') year predicate", () => {
    const { sql } = calendarMonthSeriesQuery({}, "expenses", "2024");
    expect(sql).toContain("strftime('%Y', transaction_date) = ?");
  });

  it("applies NOT_INTERNAL_FLOW predicate", () => {
    const { sql } = calendarMonthSeriesQuery({}, "expenses", "2024");
    expect(sql).toContain(NOT_INTERNAL_FLOW_FRAGMENT);
  });

  it("net metric differs from expenses metric", () => {
    const expensesSql = calendarMonthSeriesQuery({}, "expenses", "2024").sql;
    const netSql = calendarMonthSeriesQuery({}, "net", "2024").sql;
    expect(expensesSql).not.toEqual(netSql);
  });
});

describe("calendarYearHeatmapQuery", () => {
  it("groups by transaction_date", () => {
    const { sql } = calendarYearHeatmapQuery({}, "expenses", "2025");
    expect(sql).toContain("GROUP BY transaction_date");
    expect(sql).toContain("ORDER BY date");
  });

  it("selects date, value, txn_count", () => {
    const { sql } = calendarYearHeatmapQuery({}, "expenses", "2025");
    expect(sql).toContain("AS date");
    expect(sql).toContain("AS value");
    expect(sql).toContain("AS txn_count");
  });

  it("filters by strftime('%Y') year predicate", () => {
    const { sql } = calendarYearHeatmapQuery({}, "expenses", "2025");
    expect(sql).toContain("strftime('%Y', transaction_date) = ?");
  });

  it("year param is last when no filters", () => {
    const { params } = calendarYearHeatmapQuery({}, "expenses", "2025");
    expect(params).toEqual(["2025"]);
  });

  it("filter params precede the year param", () => {
    const filters = { institutions: ["chase"], startDate: "2025-01-01" };
    const { params } = calendarYearHeatmapQuery(filters, "expenses", "2025");
    expect(params[0]).toBe("2025-01-01");
    expect(params[1]).toBe("chase");
    expect(params[params.length - 1]).toBe("2025");
  });

  it("applies NOT_INTERNAL_FLOW predicate", () => {
    const { sql } = calendarYearHeatmapQuery({}, "expenses", "2025");
    expect(sql).toContain(NOT_INTERNAL_FLOW_FRAGMENT);
  });

  it("expenses metric uses ABS(amount) expression", () => {
    const { sql } = calendarYearHeatmapQuery({}, "expenses", "2025");
    expect(sql).toContain("ABS(amount)");
  });

  it("net metric differs from expenses metric", () => {
    const expensesSql = calendarYearHeatmapQuery({}, "expenses", "2025").sql;
    const netSql = calendarYearHeatmapQuery({}, "net", "2025").sql;
    expect(expensesSql).not.toEqual(netSql);
    expect(netSql).toContain("SUM(CASE WHEN amount > 0");
  });
});

describe("calendarDayHeatmapQuery", () => {
  it("groups by transaction_date", () => {
    const { sql } = calendarDayHeatmapQuery({}, "expenses", "2024", "03");
    expect(sql).toContain("GROUP BY transaction_date");
    expect(sql).toContain("ORDER BY date");
  });

  it("selects date, value, txn_count", () => {
    const { sql } = calendarDayHeatmapQuery({}, "expenses", "2024", "03");
    expect(sql).toContain("AS date");
    expect(sql).toContain("AS value");
    expect(sql).toContain("AS txn_count");
  });

  it("filters by year-month param appended after filter params", () => {
    const filters = { institutions: ["chase"] };
    const { params } = calendarDayHeatmapQuery(filters, "expenses", "2024", "03");
    expect(params[0]).toBe("chase");
    expect(params[params.length - 1]).toBe("2024-03");
  });

  it("year-month param is last when no filters", () => {
    const { params } = calendarDayHeatmapQuery({}, "expenses", "2024", "03");
    expect(params).toEqual(["2024-03"]);
  });

  it("SQL contains strftime('%Y-%m') predicate", () => {
    const { sql } = calendarDayHeatmapQuery({}, "expenses", "2024", "03");
    expect(sql).toContain("strftime('%Y-%m', transaction_date) = ?");
  });

  it("applies NOT_INTERNAL_FLOW predicate", () => {
    const { sql } = calendarDayHeatmapQuery({}, "expenses", "2024", "03");
    expect(sql).toContain(NOT_INTERNAL_FLOW_FRAGMENT);
  });

  it("net metric differs from expenses metric", () => {
    const expensesSql = calendarDayHeatmapQuery({}, "expenses", "2024", "03").sql;
    const netSql = calendarDayHeatmapQuery({}, "net", "2024", "03").sql;
    expect(expensesSql).not.toEqual(netSql);
  });
});

describe("dayOfWeekSeriesQuery", () => {
  it("groups by strftime('%w')", () => {
    const { sql } = dayOfWeekSeriesQuery({}, "expenses");
    expect(sql).toContain("strftime('%w', transaction_date)");
    expect(sql).toContain("GROUP BY");
    expect(sql).toContain("ORDER BY dow");
  });

  it("selects dow, value, txn_count, avg_value", () => {
    const { sql } = dayOfWeekSeriesQuery({}, "expenses");
    expect(sql).toContain("AS dow");
    expect(sql).toContain("AS value");
    expect(sql).toContain("AS txn_count");
    expect(sql).toContain("AS avg_value");
  });

  it("avg_value uses NULLIF to avoid divide-by-zero", () => {
    const { sql } = dayOfWeekSeriesQuery({}, "expenses");
    expect(sql).toContain("NULLIF(COUNT(DISTINCT transaction_date), 0)");
  });

  it("applies NOT_INTERNAL_FLOW predicate", () => {
    const { sql } = dayOfWeekSeriesQuery({}, "expenses");
    expect(sql).toContain(NOT_INTERNAL_FLOW_FRAGMENT);
  });

  it("filter params come before any builder-specific params — no extra params for whole-dataset builder", () => {
    const filters = { startDate: "2024-01-01", endDate: "2024-12-31" };
    const { params } = dayOfWeekSeriesQuery(filters, "expenses");
    expect(params[0]).toBe("2024-01-01");
    expect(params[1]).toBe("2024-12-31");
    expect(params.length).toBe(2);
  });

  it("net metric differs from expenses metric", () => {
    const expensesSql = dayOfWeekSeriesQuery({}, "expenses").sql;
    const netSql = dayOfWeekSeriesQuery({}, "net").sql;
    expect(expensesSql).not.toEqual(netSql);
  });
});

describe("seasonSeriesQuery", () => {
  it("selects season, value, txn_count", () => {
    const { sql } = seasonSeriesQuery({}, "expenses");
    expect(sql).toContain("AS season");
    expect(sql).toContain("AS value");
    expect(sql).toContain("AS txn_count");
  });

  it("uses CASE WHEN on strftime('%m') for seasons", () => {
    const compact = compactSql(seasonSeriesQuery({}, "expenses").sql);
    expect(compact).toContain("CASE strftime('%m', transaction_date)");
    expect(compact).toContain("'Winter'");
    expect(compact).toContain("'Spring'");
    expect(compact).toContain("'Summer'");
    expect(compact).toContain("'Autumn'");
  });

  it("includes all four winter months (12, 01, 02)", () => {
    const compact = compactSql(seasonSeriesQuery({}, "expenses").sql);
    expect(compact).toContain("WHEN '12' THEN 'Winter'");
    expect(compact).toContain("WHEN '01' THEN 'Winter'");
    expect(compact).toContain("WHEN '02' THEN 'Winter'");
  });

  it("applies NOT_INTERNAL_FLOW predicate", () => {
    const { sql } = seasonSeriesQuery({}, "expenses");
    expect(sql).toContain(NOT_INTERNAL_FLOW_FRAGMENT);
  });

  it("filter params precede builder-specific params — no extra params for whole-dataset builder", () => {
    const filters = { categories: ["Food"] };
    const { params } = seasonSeriesQuery(filters, "expenses");
    expect(params[0]).toBe("Food");
    expect(params.length).toBe(1);
  });

  it("net metric differs from expenses metric", () => {
    const expensesSql = seasonSeriesQuery({}, "expenses").sql;
    const netSql = seasonSeriesQuery({}, "net").sql;
    expect(expensesSql).not.toEqual(netSql);
  });
});

describe("monthOfYearSeriesQuery", () => {
  it("groups by strftime('%m') across all years", () => {
    const { sql } = monthOfYearSeriesQuery({}, "expenses");
    expect(sql).toContain("strftime('%m', transaction_date)");
    expect(sql).toContain("GROUP BY");
    expect(sql).toContain("ORDER BY month");
  });

  it("selects month, value, txn_count", () => {
    const { sql } = monthOfYearSeriesQuery({}, "expenses");
    expect(sql).toContain("AS month");
    expect(sql).toContain("AS value");
    expect(sql).toContain("AS txn_count");
  });

  it("applies NOT_INTERNAL_FLOW predicate", () => {
    const { sql } = monthOfYearSeriesQuery({}, "expenses");
    expect(sql).toContain(NOT_INTERNAL_FLOW_FRAGMENT);
  });

  it("no year constraint — whole dataset within filters", () => {
    const { sql } = monthOfYearSeriesQuery({}, "expenses");
    expect(sql).not.toContain("strftime('%Y', transaction_date) = ?");
  });

  it("net metric differs from expenses metric", () => {
    const expensesSql = monthOfYearSeriesQuery({}, "expenses").sql;
    const netSql = monthOfYearSeriesQuery({}, "net").sql;
    expect(expensesSql).not.toEqual(netSql);
  });

  it("filter params precede builder-specific params — no extra params for whole-dataset builder", () => {
    const filters = { merchants: ["Amazon"] };
    const { params } = monthOfYearSeriesQuery(filters, "expenses");
    expect(params[0]).toBe("Amazon");
    expect(params.length).toBe(1);
  });
});
