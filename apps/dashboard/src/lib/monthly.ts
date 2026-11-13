import { filtersToSearchParams, parseFilters } from "./filters";
import type { FilterParams, MonthlyCategory, MonthlySpendingRow } from "@/server/data/types";

export function parseMonth(value: string | null | undefined): string | null {
  return value && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, offset: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function monthRange(month: string, throughDay?: number | null): { startDate: string; endDate: string } {
  const last = new Date(`${month}-01T00:00:00Z`);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const day = Math.min(throughDay ?? last.getUTCDate(), last.getUTCDate());
  return { startDate: `${month}-01`, endDate: `${month}-${String(day).padStart(2, "0")}` };
}

export function nonDateFilters(filters: FilterParams): FilterParams {
  const { startDate: _start, endDate: _end, ...scope } = filters;
  void _start;
  void _end;
  return scope;
}

/** Date parameters cannot invalidate or restrict the selected monthly scope. */
export function parseMonthlyFilters(params: URLSearchParams): FilterParams {
  const scope = new URLSearchParams(params);
  scope.delete("startDate");
  scope.delete("endDate");
  const result: FilterParams = {};
  // Validate dimensions independently so an invalid direction/amount does not
  // discard a valid institution or account selection.
  for (const key of scope.keys()) {
    Object.assign(result, parseFilters(new URLSearchParams([[key, scope.get(key)!]])));
  }
  return result;
}

export function comparisonDayForMonth(month: string, latestImportedDate: string | null, selectedLatestDate: string | null, now = new Date()): number | null {
  if (month === currentMonth(now)) {
    return Math.min(now.getDate(), selectedLatestDate ? Number(selectedLatestDate.slice(8, 10)) : now.getDate());
  }
  if (selectedLatestDate && latestImportedDate?.slice(0, 7) === month) {
    const lastDay = Number(monthRange(month).endDate.slice(8, 10));
    const latestDay = Number(selectedLatestDate.slice(8, 10));
    if (latestDay < lastDay) return latestDay;
  }
  return null;
}

export function monthlyUrl(month: string, filters: FilterParams): string {
  const params = filtersToSearchParams(nonDateFilters(filters));
  params.set("month", month);
  return `/monthly?${params}`;
}

/** Transaction results retain ordinary ledger rows, including excluded transfers. */
export function monthlyTransactionUrl(month: string, filters: FilterParams, detail: { category?: string; merchant?: string } = {}): string {
  const scope = { ...nonDateFilters(filters), ...monthRange(month), direction: "debit" as const };
  if (detail.category !== undefined) {
    delete scope.categories;
    delete scope.uncategorizedOnly;
    if (detail.category === "Uncategorized") scope.uncategorizedOnly = true;
    else scope.categories = [detail.category];
  }
  if (detail.merchant !== undefined) scope.merchants = [detail.merchant];
  return `/transactions?${filtersToSearchParams(scope)}`;
}

export function monthlyCategories(actual: MonthlySpendingRow[], comparison: MonthlySpendingRow[], previous: MonthlySpendingRow[][]): MonthlyCategory[] {
  const byCategory = (rows: MonthlySpendingRow[]) => new Map(rows.filter((r) => r.count > 0).map((r) => [r.category!, r]));
  const actualMap = byCategory(actual);
  const comparisonMap = byCategory(comparison);
  const history = previous.map(byCategory);
  const priorAvailable = (previous[0]?.[0]?.importedCount ?? 0) > 0;
  const averageAvailable = previous.length === 3 && previous.every((rows) => (rows[0]?.importedCount ?? 0) > 0);
  const total = actual.reduce((sum, row) => sum + row.amount, 0);
  const categories = new Set([...actualMap.keys(), ...comparisonMap.keys(), ...history.flatMap((map) => [...map.keys()])]);
  return [...categories].map((category) => {
    const actualRow = actualMap.get(category);
    const comparisonAmount = comparisonMap.get(category)?.amount ?? 0;
    const previousAmount = priorAvailable ? history[0].get(category)?.amount ?? 0 : null;
    return {
      category,
      amount: actualRow?.amount ?? 0,
      count: actualRow?.count ?? 0,
      percentage: total > 0 ? (actualRow?.amount ?? 0) / total * 100 : 0,
      comparisonAmount,
      previousAmount,
      previousDifference: previousAmount === null ? null : comparisonAmount - previousAmount,
      previousPercent: previousAmount === null || previousAmount === 0 ? null : (comparisonAmount - previousAmount) / previousAmount * 100,
      threeMonthAverage: averageAvailable ? history.reduce((sum, map) => sum + (map.get(category)?.amount ?? 0), 0) / 3 : null,
      isNew: previousAmount === 0 && comparisonAmount > 0,
    };
  }).sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
}
