import AppShell from "@/components/layout/app-shell";
import { canShare } from "@/server/auth/can-share";
import TransactionsTable from "./transactions-table";
import { parseFilters } from "@/lib/filters";
import {
  getTransactions,
  getFilterOptions,
} from "@/server/data/repository";
import TransactionsClient from "./transactions-client";

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
      <h2 className="text-lg font-semibold">No data available</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Run <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">ledgerlift e2e --force</code> to process
        statements and rebuild the database.
      </p>
    </div>
  );
}

export default async function TransactionsPage({
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
  const page = Math.max(1, Number(params.page) || 1);
  const sortBy = (typeof params.sortBy === "string" ? params.sortBy : "transaction_date") as string;
  const sortDir = (params.sortDir === "asc" ? "asc" : "desc") as "asc" | "desc";
  const showShare = await canShare();

  let result: Awaited<ReturnType<typeof getTransactions>>;
  let filterOptions: Awaited<ReturnType<typeof getFilterOptions>>;
  try {
    [result, filterOptions] = await Promise.all([
      getTransactions(filters, page, 50, sortBy, sortDir),
      getFilterOptions(),
    ]);
  } catch (err) {
    console.error("[transactions/page] failed to load:", err);
    return (
      <AppShell canShare={showShare} pageTitle="Transactions">
        <EmptyState />
      </AppShell>
    );
  }

  return (
    <AppShell canShare={showShare} pageTitle="Transactions">
      <div className="space-y-6">
        <TransactionsClient
          institutions={filterOptions.institutions}
          categories={filterOptions.categories}
        />
        <TransactionsTable
          transactions={result.data}
          total={result.total}
          page={result.page}
          pageSize={result.pageSize}
          sortBy={sortBy}
          sortDir={sortDir}
        />
      </div>
    </AppShell>
  );
}
