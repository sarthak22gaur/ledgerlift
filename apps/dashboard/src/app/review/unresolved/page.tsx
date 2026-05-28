import AppShell from "@/components/layout/app-shell";
import { canShare } from "@/server/auth/can-share";
import UnresolvedTable from "./unresolved-table";
import { parseFilters } from "@/lib/filters";
import { getUnresolvedTransactions } from "@/server/data/repository";

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

export default async function UnresolvedPage({
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
  const showShare = await canShare();

  let result: Awaited<ReturnType<typeof getUnresolvedTransactions>>;
  try {
    result = await getUnresolvedTransactions(filters, page, 50);
  } catch (err) {
    console.error("[review/unresolved/page] failed to load:", err);
    return (
      <AppShell canShare={showShare} pageTitle="Unresolved Transactions">
        <EmptyState />
      </AppShell>
    );
  }

  return (
    <AppShell canShare={showShare} pageTitle="Unresolved Transactions">
      <div className="space-y-6">
        <div className="rounded-lg border bg-muted/50 p-4 text-sm text-muted-foreground">
          Transactions without a confirmed category or merchant mapping.
        </div>
        <UnresolvedTable
          transactions={result.data}
          total={result.total}
          page={result.page}
          pageSize={result.pageSize}
        />
      </div>
    </AppShell>
  );
}
