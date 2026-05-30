import { query } from "./db";
import {
  overviewMetricsQuery,
  cashflowSeriesQuery,
  categoryBreakdownQuery,
  topMerchantsQuery,
  allMerchantsQuery,
  allMerchantsCountQuery,
  transactionsQuery,
  transactionsCountQuery,
  transactionByIdQuery,
  categoryDetailQuery,
  merchantDetailQuery,
  unresolvedTransactionsQuery,
  transferCandidatesQuery,
  transferPairsQuery,
  accountSummaryQuery,
  calendarYearSeriesQuery,
  calendarMonthSeriesQuery,
  calendarDayHeatmapQuery,
  dayOfWeekSeriesQuery,
  seasonSeriesQuery,
  monthOfYearSeriesQuery,
} from "./queries";
import type {
  FilterParams,
  OverviewMetrics,
  CashflowSeries,
  CategoryBreakdown,
  MerchantSummary,
  Transaction,
  TransferPair,
  PaginatedResult,
  CalendarYearPoint,
  CalendarMonthPoint,
  CalendarDayPoint,
  DayOfWeekPoint,
  SeasonPoint,
  MonthOfYearPoint,
} from "./types";

export async function getOverviewMetrics(
  filters: FilterParams
): Promise<OverviewMetrics> {
  const { sql, params } = overviewMetricsQuery(filters);
  const rows = await query<OverviewMetrics>(sql, params);
  return (
    rows[0] ?? {
      totalIncome: 0,
      totalExpenses: 0,
      netCashflow: 0,
      uncategorizedSpend: 0,
      transactionCount: 0,
      transferPairCount: 0,
      transferAmount: 0,
    }
  );
}

export async function getCashflowSeries(
  filters: FilterParams
): Promise<CashflowSeries[]> {
  const { sql, params } = cashflowSeriesQuery(filters);
  return query<CashflowSeries>(sql, params);
}

export async function getCategoryBreakdown(
  filters: FilterParams
): Promise<CategoryBreakdown[]> {
  const { sql, params } = categoryBreakdownQuery(filters);
  return query<CategoryBreakdown>(sql, params);
}

export async function getTopMerchants(
  filters: FilterParams,
  limit: number = 10
): Promise<MerchantSummary[]> {
  const { sql, params } = topMerchantsQuery(filters, limit);
  return query<MerchantSummary>(sql, params);
}

export async function getAllMerchants(
  filters: FilterParams,
  page: number = 1,
  pageSize: number = 50,
  sortBy: string = "amount",
  sortDir: "asc" | "desc" = "desc"
): Promise<PaginatedResult<MerchantSummary>> {
  const dataQ = allMerchantsQuery(filters, page, pageSize, sortBy, sortDir);
  const countQ = allMerchantsCountQuery(filters);

  const [data, countRows] = await Promise.all([
    query<MerchantSummary>(dataQ.sql, dataQ.params),
    query<{ total: number }>(countQ.sql, countQ.params),
  ]);

  return {
    data,
    total: countRows[0]?.total ?? 0,
    page,
    pageSize,
  };
}

export async function getTransactions(
  filters: FilterParams,
  page: number = 1,
  pageSize: number = 50,
  sortBy: string = "transaction_date",
  sortDir: "asc" | "desc" = "desc"
): Promise<PaginatedResult<Transaction>> {
  const dataQ = transactionsQuery(filters, page, pageSize, sortBy, sortDir);
  const countQ = transactionsCountQuery(filters);

  const [data, countRows] = await Promise.all([
    query<Transaction>(dataQ.sql, dataQ.params),
    query<{ total: number }>(countQ.sql, countQ.params),
  ]);

  return {
    data,
    total: countRows[0]?.total ?? 0,
    page,
    pageSize,
  };
}

export async function getTransactionById(
  id: string
): Promise<Transaction | null> {
  const { sql, params } = transactionByIdQuery(id);
  const rows = await query<Transaction>(sql, params);
  return rows[0] ?? null;
}

export async function getCategoryDetails(
  category: string,
  filters: FilterParams
): Promise<Transaction[]> {
  const { sql, params } = categoryDetailQuery(category, filters);
  return query<Transaction>(sql, params);
}

export async function getMerchantDetails(
  merchant: string,
  filters: FilterParams
): Promise<Transaction[]> {
  const { sql, params } = merchantDetailQuery(merchant, filters);
  return query<Transaction>(sql, params);
}

export async function getUnresolvedTransactions(
  filters: FilterParams,
  page: number = 1,
  pageSize: number = 50
): Promise<PaginatedResult<Transaction>> {
  const { sql, params } = unresolvedTransactionsQuery(filters);
  const allRows = await query<Transaction>(sql, params);

  const total = allRows.length;
  const offset = (page - 1) * pageSize;
  const data = allRows.slice(offset, offset + pageSize);

  return { data, total, page, pageSize };
}

export async function getTransferCandidates(
  filters: FilterParams,
  page: number = 1,
  pageSize: number = 50
): Promise<PaginatedResult<Transaction>> {
  const { sql, params } = transferCandidatesQuery(filters);
  const allRows = await query<Transaction>(sql, params);

  const total = allRows.length;
  const offset = (page - 1) * pageSize;
  const data = allRows.slice(offset, offset + pageSize);

  return { data, total, page, pageSize };
}

export async function getTransferPairs(
  filters: FilterParams
): Promise<TransferPair[]> {
  const { sql, params } = transferPairsQuery(filters);
  return query<TransferPair>(sql, params);
}

export async function getAccountSummary(
  filters: FilterParams
): Promise<
  {
    id: string;
    institution: string;
    account_name: string;
    account_type: string;
    first_seen: string;
    last_seen: string;
    transaction_count: number;
    total_income: number;
    total_expenses: number;
  }[]
> {
  const { sql, params } = accountSummaryQuery(filters);
  return query(sql, params);
}

export async function getCalendarYearSeries(
  filters: FilterParams,
  metric: "expenses" | "net"
): Promise<CalendarYearPoint[]> {
  const { sql, params } = calendarYearSeriesQuery(filters, metric);
  return query<CalendarYearPoint>(sql, params);
}

export async function getCalendarMonthSeries(
  filters: FilterParams,
  metric: "expenses" | "net",
  year: string
): Promise<CalendarMonthPoint[]> {
  const { sql, params } = calendarMonthSeriesQuery(filters, metric, year);
  return query<CalendarMonthPoint>(sql, params);
}

export async function getCalendarDayHeatmap(
  filters: FilterParams,
  metric: "expenses" | "net",
  year: string,
  month: string
): Promise<CalendarDayPoint[]> {
  const { sql, params } = calendarDayHeatmapQuery(filters, metric, year, month);
  return query<CalendarDayPoint>(sql, params);
}

export async function getDayOfWeekSeries(
  filters: FilterParams,
  metric: "expenses" | "net"
): Promise<DayOfWeekPoint[]> {
  const { sql, params } = dayOfWeekSeriesQuery(filters, metric);
  return query<DayOfWeekPoint>(sql, params);
}

export async function getSeasonSeries(
  filters: FilterParams,
  metric: "expenses" | "net"
): Promise<SeasonPoint[]> {
  const { sql, params } = seasonSeriesQuery(filters, metric);
  return query<SeasonPoint>(sql, params);
}

export async function getMonthOfYearSeries(
  filters: FilterParams,
  metric: "expenses" | "net"
): Promise<MonthOfYearPoint[]> {
  const { sql, params } = monthOfYearSeriesQuery(filters, metric);
  return query<MonthOfYearPoint>(sql, params);
}

export async function getDateRange(): Promise<{
  minDate: string;
  maxDate: string;
}> {
  const rows = await query<{ min_date: string; max_date: string }>(
    "SELECT CAST(MIN(transaction_date) AS TEXT) AS min_date, CAST(MAX(transaction_date) AS TEXT) AS max_date FROM transactions"
  );
  return {
    minDate: rows[0]?.min_date ?? new Date().toISOString().slice(0, 10),
    maxDate: rows[0]?.max_date ?? new Date().toISOString().slice(0, 10),
  };
}

export async function getFilterOptions(): Promise<{
  institutions: string[];
  accounts: string[];
  categories: string[];
  merchants: string[];
}> {
  const [institutions, accounts, categories, merchants] = await Promise.all([
    query<{ institution: string }>(
      "SELECT DISTINCT institution FROM transactions WHERE institution IS NOT NULL ORDER BY institution"
    ),
    query<{ account_name: string }>(
      "SELECT DISTINCT account_name FROM transactions WHERE account_name IS NOT NULL ORDER BY account_name"
    ),
    query<{ category_normalized: string }>(
      "SELECT DISTINCT category_normalized FROM transactions WHERE category_normalized IS NOT NULL AND category_normalized != 'Uncategorized' ORDER BY category_normalized"
    ),
    query<{ merchant_normalized: string }>(
      "SELECT DISTINCT merchant_normalized FROM transactions WHERE merchant_normalized IS NOT NULL ORDER BY merchant_normalized"
    ),
  ]);

  return {
    institutions: institutions.map((r) => r.institution),
    accounts: accounts.map((r) => r.account_name),
    categories: categories.map((r) => r.category_normalized),
    merchants: merchants.map((r) => r.merchant_normalized),
  };
}
