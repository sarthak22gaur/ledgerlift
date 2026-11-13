import { query } from "./db";
import { detectCategorizationReview } from "@/lib/categorization-review";
import { listCategoryOverrides, listMerchantOverrides } from "@/server/rules/repository";
import { comparisonDayForMonth, currentMonth, monthRange, monthlyCategories, nonDateFilters, parseMonth, shiftMonth } from "@/lib/monthly";
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
  calendarYearHeatmapQuery,
  calendarDayHeatmapQuery,
  dayOfWeekSeriesQuery,
  seasonSeriesQuery,
  monthOfYearSeriesQuery,
  monthlyImportedScopeQuery,
  monthlySpendingQuery,
  categorizationReviewCandidatesQuery,
  categorizationReviewBaselineQuery,
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
  MonthlyOverview,
  MonthlySpendingRow,
  CategorizationReviewRow,
  CategorizationBaselineRow,
} from "./types";

export async function getCategorizationReview(
  filters: FilterParams, page = 1, pageSize = 50,
): Promise<PaginatedResult<CategorizationReviewRow>> {
  const candidates = categorizationReviewCandidatesQuery(filters);
  const baselines = categorizationReviewBaselineQuery(filters);
  const [rows, baselineRows, categoryOverrides, merchantOverrides] = await Promise.all([
    query<Transaction>(candidates.sql, candidates.params),
    query<CategorizationBaselineRow>(baselines.sql, baselines.params),
    listCategoryOverrides(), listMerchantOverrides(),
  ]);
  return detectCategorizationReview(rows, baselineRows, [...categoryOverrides, ...merchantOverrides], page, pageSize);
}

export async function getMonthlyOverview(
  requestedMonth: string | null,
  filters: FilterParams,
  now = new Date()
): Promise<MonthlyOverview> {
  const scope = nonDateFilters(filters);
  const latestQuery = monthlyImportedScopeQuery(scope);
  const latestRows = await query<{ latestDate: string | null }>(latestQuery.sql, latestQuery.params);
  const latestImportedDate = latestRows[0]?.latestDate ?? null;
  const month = parseMonth(requestedMonth) ?? latestImportedDate?.slice(0, 7) ?? currentMonth(now);
  const range = monthRange(month);
  const selectedFilters = { ...scope, ...range };
  const actualQuery = monthlySpendingQuery(selectedFilters);
  const actual = await query<MonthlySpendingRow>(actualQuery.sql, actualQuery.params);
  const selectedLatestDate = actual[0]?.latestDate ?? null;
  const comparisonDay = comparisonDayForMonth(month, latestImportedDate, selectedLatestDate, now);
  const comparisonRange = monthRange(month, comparisonDay);
  const fetchWindow = async (windowMonth: string) => {
    const built = monthlySpendingQuery({ ...scope, ...monthRange(windowMonth, comparisonDay) });
    return query<MonthlySpendingRow>(built.sql, built.params);
  };
  const [comparison, previous, metrics, merchants] = await Promise.all([
    comparisonRange.endDate === range.endDate ? Promise.resolve(actual) : fetchWindow(month),
    Promise.all([1, 2, 3].map((offset) => fetchWindow(shiftMonth(month, -offset)))),
    getOverviewMetrics(selectedFilters),
    getTopMerchants(selectedFilters),
  ]);
  return {
    month, ...range, filters: selectedFilters, latestImportedDate, selectedLatestDate,
    transactionCount: actual[0]?.importedCount ?? 0,
    comparisonDay,
    comparisonEndDate: comparisonRange.endDate,
    categorySpending: actual.reduce((sum, row) => sum + row.amount, 0),
    categories: monthlyCategories(actual, comparison, previous),
    merchants,
    metrics,
  };
}

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

export async function getCalendarYearHeatmap(
  filters: FilterParams,
  metric: "expenses" | "net",
  year: string
): Promise<CalendarDayPoint[]> {
  const { sql, params } = calendarYearHeatmapQuery(filters, metric, year);
  return query<CalendarDayPoint>(sql, params);
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
