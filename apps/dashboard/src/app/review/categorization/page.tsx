import AppShell from "@/components/layout/app-shell";
import FilterBar from "@/components/filters/filter-bar";
import { canShare } from "@/server/auth/can-share";
import { parseFilters } from "@/lib/filters";
import { getCategorizationReview, getFilterOptions } from "@/server/data/repository";
import CategorizationReviewList from "./review-list";

export default async function CategorizationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") sp.set(key, value);
    else if (Array.isArray(value)) value.forEach((v) => sp.append(key, v));
  }
  const filters = parseFilters(sp);
  const requestedPage = Number(sp.get("page"));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const canEdit = await canShare();

  let result: Awaited<ReturnType<typeof getCategorizationReview>>;
  let options: Awaited<ReturnType<typeof getFilterOptions>>;
  try {
    [result, options] = await Promise.all([
      getCategorizationReview(filters, page, 50),
      getFilterOptions(),
    ]);
  } catch (err) {
    console.error("[review/categorization/page] failed to load:", err);
    return (
      <AppShell canShare={canEdit} pageTitle="Categorization">
        <div role="alert" className="rounded-lg border border-destructive/30 p-6">
          <h2 className="font-semibold">Categorization review could not be loaded</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The ledger could not be read. Check the database connection and reload this page.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell canShare={canEdit} pageTitle="Categorization">
      <div className="space-y-6">
        <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          <h2 className="mb-1 font-medium text-foreground">A second look at categorized transactions</h2>
          <p>
            These transactions are worth reviewing because of their retailer, mapping, or amount.
            The signals do not establish a category error. Transactions with more signals appear first;
            amounts are ranked within each currency.
          </p>
          <p className="mt-2">
            Confirming or changing a category saves a choice for that transaction only.
            You can keep reviewing before running <code className="font-mono text-xs">ledgerlift enrich --force</code>;
            derived categories and dashboard totals update after that step.
          </p>
        </div>
        <FilterBar institutions={options.institutions} categories={options.categories} />
        <CategorizationReviewList
          transactions={result.data}
          total={result.total}
          page={result.page}
          pageSize={result.pageSize}
          categories={options.categories}
          canEdit={canEdit}
        />
      </div>
    </AppShell>
  );
}
