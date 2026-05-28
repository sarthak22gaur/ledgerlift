import type { FilterParams } from "@/server/data/types";
import { filterSchema } from "./schemas";

/**
 * Parse URLSearchParams into a validated FilterParams object.
 * Array values are encoded as comma-separated strings.
 */
export function parseFilters(searchParams: URLSearchParams): FilterParams {
  const raw: Record<string, unknown> = {};

  const str = (key: string) => {
    const v = searchParams.get(key);
    if (v) raw[key] = v;
  };

  const arr = (key: string) => {
    const v = searchParams.get(key);
    if (v) raw[key] = v.split(",").filter(Boolean);
  };

  const num = (key: string) => {
    const v = searchParams.get(key);
    if (v) raw[key] = Number(v);
  };

  const bool = (key: string) => {
    const v = searchParams.get(key);
    if (v === "true" || v === "1") raw[key] = true;
  };

  str("startDate");
  str("endDate");
  arr("institutions");
  arr("accounts");
  arr("categories");
  arr("merchants");
  str("direction");
  num("minAmount");
  num("maxAmount");
  str("search");
  bool("uncategorizedOnly");
  bool("transferCandidatesOnly");

  const result = filterSchema.safeParse(raw);
  return result.success ? result.data : {};
}

/**
 * Serialize FilterParams back to URLSearchParams.
 */
export function filtersToSearchParams(filters: FilterParams): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.institutions?.length)
    params.set("institutions", filters.institutions.join(","));
  if (filters.accounts?.length)
    params.set("accounts", filters.accounts.join(","));
  if (filters.categories?.length)
    params.set("categories", filters.categories.join(","));
  if (filters.merchants?.length)
    params.set("merchants", filters.merchants.join(","));
  if (filters.direction) params.set("direction", filters.direction);
  if (filters.minAmount != null)
    params.set("minAmount", String(filters.minAmount));
  if (filters.maxAmount != null)
    params.set("maxAmount", String(filters.maxAmount));
  if (filters.search) params.set("search", filters.search);
  if (filters.uncategorizedOnly) params.set("uncategorizedOnly", "true");
  if (filters.transferCandidatesOnly)
    params.set("transferCandidatesOnly", "true");

  return params;
}

/**
 * Count active (non-default) filters.
 */
export function getActiveFilterCount(filters: FilterParams): number {
  let count = 0;
  if (filters.startDate) count++;
  if (filters.endDate) count++;
  if (filters.institutions?.length) count++;
  if (filters.accounts?.length) count++;
  if (filters.categories?.length) count++;
  if (filters.merchants?.length) count++;
  if (filters.direction) count++;
  if (filters.minAmount != null) count++;
  if (filters.maxAmount != null) count++;
  if (filters.search) count++;
  if (filters.uncategorizedOnly) count++;
  if (filters.transferCandidatesOnly) count++;
  return count;
}

/**
 * Check if filters are all at their defaults (empty).
 */
export function isDefaultFilters(filters: FilterParams): boolean {
  return getActiveFilterCount(filters) === 0;
}
