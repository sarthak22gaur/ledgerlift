import AppShell from "@/components/layout/app-shell";
import { canShare } from "@/server/auth/can-share";
import { parseFilters } from "@/lib/filters";
import { getAllMerchants } from "@/server/data/repository";
import MerchantsTable from "./merchants-table";

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

export default async function MerchantsPage({
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
  const sortBy = (typeof params.sortBy === "string" ? params.sortBy : "amount") as string;
  const sortDir = (params.sortDir === "asc" ? "asc" : "desc") as "asc" | "desc";
  const showShare = await canShare();

  let result: Awaited<ReturnType<typeof getAllMerchants>>;
  try {
    result = await getAllMerchants(filters, page, 50, sortBy, sortDir);
  } catch (err) {
    console.error("[merchants/page] failed to load:", err);
    return (
      <AppShell canShare={showShare} pageTitle="Merchants">
        <EmptyState />
      </AppShell>
    );
  }

  return (
    <AppShell canShare={showShare} pageTitle="Merchants">
      <div className="space-y-6">
        <MerchantsTable
          merchants={result.data}
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
