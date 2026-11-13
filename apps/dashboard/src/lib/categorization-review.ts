import type { OverrideEntry } from "@/lib/schemas";
import type {
  CategorizationBaselineRow, CategorizationReviewReason, CategorizationReviewRow,
  PaginatedResult, Transaction,
} from "@/server/data/types";

const MIXED_RETAILERS = new Set(["Costco", "Amazon", "Walmart", "Target"]);

export function categoryReviewOverrideId(transactionId: string): string {
  return `category-review:${transactionId}`;
}

function categoryConfirmed(transaction: Transaction, overrides: OverrideEntry[]): boolean {
  if (transaction.category_rule_id?.startsWith("override:")) return true;
  return overrides.some((override) => {
    if (!override.category) return false;
    if (override.transaction_id) return override.transaction_id === transaction.transaction_id;
    if (!override.pattern) return false;
    try {
      // Python rules commonly put global flags at the start of the pattern.
      const inlineFlags = override.pattern.match(/^\(\?([ims]+)\)/);
      const pattern = inlineFlags ? override.pattern.slice(inlineFlags[0].length) : override.pattern;
      const flags = [...new Set(`i${inlineFlags?.[1] ?? ""}`)].join("");
      return new RegExp(pattern, flags).test(transaction.description_raw);
    } catch {
      return false;
    }
  });
}

type Cohort = { amounts: number[]; ids: Set<string> };
type Cohorts = Map<string, Cohort>;

function cohortKey(row: CategorizationBaselineRow, field: "merchant_normalized" | "category_normalized"): string {
  return JSON.stringify([row.currency, row.direction, row[field]]);
}

function buildCohorts(rows: CategorizationBaselineRow[], field: "merchant_normalized" | "category_normalized"): Cohorts {
  const cohorts: Cohorts = new Map();
  for (const row of rows) {
    if (!row[field] || row.amount === 0) continue;
    const key = cohortKey(row, field);
    const cohort = cohorts.get(key) ?? { amounts: [], ids: new Set<string>() };
    cohort.amounts.push(Math.abs(row.amount));
    cohort.ids.add(row.transaction_id);
    cohorts.set(key, cohort);
  }
  for (const cohort of cohorts.values()) cohort.amounts.sort((a, b) => a - b);
  return cohorts;
}

function baselineReason(
  transaction: Transaction, cohorts: Cohorts, baseline: "merchant" | "category", minimum: number, threshold: number,
): CategorizationReviewReason | null {
  const field = baseline === "merchant" ? "merchant_normalized" : "category_normalized";
  if (!transaction[field]) return null;
  const cohort = cohorts.get(cohortKey(transaction, field));
  if (!cohort) return null;
  const selfIncluded = cohort.ids.has(transaction.transaction_id);
  const sampleCount = cohort.amounts.length - Number(selfIncluded);
  if (sampleCount < minimum) return null;
  // Removing any equal amount gives the same median, even when several peers tie.
  let selfIndex = cohort.amounts.length;
  if (selfIncluded) {
    let low = 0;
    let high = cohort.amounts.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (cohort.amounts[mid] < Math.abs(transaction.amount)) low = mid + 1;
      else high = mid;
    }
    selfIndex = low;
  }
  const at = (index: number) => cohort.amounts[index + Number(selfIncluded && index >= selfIndex)];
  const middle = Math.floor(sampleCount / 2);
  const median = sampleCount % 2 ? at(middle) : (at(middle - 1) + at(middle)) / 2;
  if (median <= 0) return null;
  const ratio = Math.abs(transaction.amount) / median;
  if (ratio < threshold) return null;
  return {
    kind: "unusual-amount", label: "Unusually large amount", baseline,
    ratio, median, sampleCount, currency: transaction.currency,
  };
}

export function detectCategorizationReview(
  candidates: Transaction[], baselineRows: CategorizationBaselineRow[], overrides: OverrideEntry[] = [],
  page = 1, pageSize = 50,
): PaginatedResult<CategorizationReviewRow> {
  const merchantCohorts = buildCohorts(baselineRows, "merchant_normalized");
  const categoryCohorts = buildCohorts(baselineRows, "category_normalized");
  const reviewed: CategorizationReviewRow[] = [];
  for (const transaction of candidates) {
    if (!transaction.category_normalized || transaction.category_normalized === "Uncategorized" || categoryConfirmed(transaction, overrides)) continue;
    const reviewReasons: CategorizationReviewReason[] = [];
    if (MIXED_RETAILERS.has(transaction.merchant_normalized ?? "") && transaction.category_rule_id && transaction.category_rule_id === transaction.merchant_rule_id) {
      reviewReasons.push({ kind: "mixed-retailer", label: "Mixed retailer with a merchant-default category" });
    }
    if (transaction.category_rule_id?.startsWith("fuzzy:") || transaction.category_rule_id?.startsWith("type:") || (transaction.category_confidence != null && transaction.category_confidence < 0.8)) {
      reviewReasons.push({ kind: "weak-mapping", label: "Weak category mapping" });
    }
    const amountReason = baselineReason(transaction, merchantCohorts, "merchant", 5, 3)
      ?? baselineReason(transaction, categoryCohorts, "category", 10, 5);
    if (amountReason) reviewReasons.push(amountReason);
    if (reviewReasons.length) reviewed.push({ ...transaction, reviewReasons });
  }
  const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  reviewed.sort((a, b) => b.reviewReasons.length - a.reviewReasons.length
    || compareText(a.currency, b.currency)
    || Math.abs(b.amount) - Math.abs(a.amount)
    || compareText(b.transaction_date, a.transaction_date)
    || compareText(a.transaction_id, b.transaction_id));
  const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 50;
  const safePage = Math.min(Math.max(1, Number.isInteger(page) ? page : 1), Math.max(1, Math.ceil(reviewed.length / safePageSize)));
  return {
    data: reviewed.slice((safePage - 1) * safePageSize, safePage * safePageSize),
    total: reviewed.length, page: safePage, pageSize: safePageSize,
  };
}
