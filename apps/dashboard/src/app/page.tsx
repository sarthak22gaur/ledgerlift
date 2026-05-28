import AppShell from "@/components/layout/app-shell";
import { canShare } from "@/server/auth/can-share";
import KpiGrid from "@/components/dashboard/kpi-grid";
import CashflowChart from "@/components/charts/cashflow-chart";
import CategoryChart from "@/components/charts/category-chart";
import RecentTransactions from "@/components/dashboard/recent-transactions";
import TopMerchants from "@/components/dashboard/top-merchants";
import DateRangeSlider from "@/components/dashboard/date-range-slider";
import { Card, CardContent } from "@/components/ui/card";
import { parseFilters } from "@/lib/filters";
import {
  getOverviewMetrics,
  getCashflowSeries,
  getCategoryBreakdown,
  getTopMerchants,
  getTransactions,
  getDateRange,
} from "@/server/data/repository";

async function loadDashboardData(filters: ReturnType<typeof parseFilters>) {
  const [metrics, cashflow, categories, merchants, recentResult, dateRange] =
    await Promise.all([
      getOverviewMetrics(filters),
      getCashflowSeries(filters),
      getCategoryBreakdown(filters),
      getTopMerchants(filters, 10),
      getTransactions(filters, 1, 10),
      getDateRange(),
    ]);

  return { metrics, cashflow, categories, merchants, recentResult, dateRange };
}

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

export default async function DashboardPage({
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
  const showShare = await canShare();

  let data: Awaited<ReturnType<typeof loadDashboardData>>;
  try {
    data = await loadDashboardData(filters);
  } catch (err) {
    console.error("[overview/page] failed to load:", err);
    return (
      <AppShell pageTitle="Overview" canShare={showShare}>
        <EmptyState />
      </AppShell>
    );
  }

  return (
    <AppShell pageTitle="Overview" canShare={showShare}>
      <div className="space-y-6">
        <DateRangeSlider minDate={data.dateRange.minDate} maxDate={data.dateRange.maxDate} />
        <KpiGrid metrics={data.metrics} />

        <div className="grid gap-6 lg:grid-cols-2">
          <CashflowChart data={data.cashflow} />
          <Card>
            <CardContent>
              <CategoryChart data={data.categories} />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <TopMerchants merchants={data.merchants} />
          <RecentTransactions transactions={data.recentResult.data} />
        </div>
      </div>
    </AppShell>
  );
}
