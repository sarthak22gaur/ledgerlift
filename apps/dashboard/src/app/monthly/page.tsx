import AppShell from "@/components/layout/app-shell";
import MonthlyControls from "@/components/monthly/monthly-controls";
import MonthlyView, { monthLabel } from "@/components/monthly/monthly-view";
import { parseMonthlyFilters } from "@/lib/monthly";
import { canShare } from "@/server/auth/can-share";
import { getFilterOptions, getMonthlyOverview } from "@/server/data/repository";

export default async function MonthlyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") sp.set(key, value);
    else if (Array.isArray(value)) value.forEach((item) => sp.append(key, item));
  }
  const filters = parseMonthlyFilters(sp);
  const showShare = await canShare();
  let data: Awaited<ReturnType<typeof getMonthlyOverview>>;
  let options: Awaited<ReturnType<typeof getFilterOptions>>;
  try {
    [data, options] = await Promise.all([getMonthlyOverview(sp.get("month"), filters), getFilterOptions()]);
  } catch {
    return <AppShell pageTitle="Monthly Overview" canShare={showShare}><div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-6"><h1 className="text-lg font-semibold">Monthly overview could not be loaded</h1><p className="mt-2 text-sm text-muted-foreground">The ledger could not be read. Try reloading this page after checking the database connection.</p></div></AppShell>;
  }
  return (
    <AppShell pageTitle="Monthly Overview" canShare={showShare}>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
          <div><p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Monthly Overview</p><h1 className="text-3xl font-semibold tracking-tight">{monthLabel(data.month)}</h1><p className="mt-2 text-sm text-muted-foreground">Where spending went, and how it changed.</p></div>
          <MonthlyControls month={data.month} filters={data.filters} institutions={options.institutions} accounts={options.accounts} />
        </div>
        <MonthlyView data={data} />
      </div>
    </AppShell>
  );
}
