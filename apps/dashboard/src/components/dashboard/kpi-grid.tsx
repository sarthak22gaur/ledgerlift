import { DollarSign, TrendingUp, TrendingDown, CircleHelp, ArrowRightLeft } from "lucide-react";
import type { OverviewMetrics } from "@/server/data/types";
import { formatCurrency } from "@/lib/currency";
import KpiCard from "@/components/dashboard/kpi-card";

type KpiGridProps = {
  metrics: OverviewMetrics;
};

export default function KpiGrid({ metrics }: KpiGridProps) {
  const net = metrics.netCashflow;
  const netTrend: "up" | "down" | "neutral" =
    net > 0 ? "up" : net < 0 ? "down" : "neutral";

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        title="Income"
        value={formatCurrency(metrics.totalIncome)}
        icon={TrendingUp}
        trend="up"
        trendValue={`${metrics.transactionCount} txns`}
      />
      <KpiCard
        title="Expenses"
        value={formatCurrency(metrics.totalExpenses)}
        icon={TrendingDown}
        trend="down"
        trendValue={formatCurrency(metrics.totalExpenses)}
        subtitle="total spend"
      />
      <KpiCard
        title="Net Cashflow"
        value={formatCurrency(net)}
        icon={DollarSign}
        trend={netTrend}
        trendValue={formatCurrency(Math.abs(net))}
        subtitle={net >= 0 ? "surplus" : "deficit"}
      />
      {metrics.transferPairCount > 0 ? (
        <KpiCard
          title="Transfers"
          value={`${metrics.transferPairCount} pairs`}
          icon={ArrowRightLeft}
          trend="neutral"
          trendValue={`${formatCurrency(metrics.transferAmount)} eliminated`}
          subtitle={
            metrics.uncategorizedSpend > 0
              ? `${formatCurrency(metrics.uncategorizedSpend)} uncategorized`
              : undefined
          }
        />
      ) : (
        <KpiCard
          title="Uncategorized"
          value={formatCurrency(metrics.uncategorizedSpend)}
          icon={CircleHelp}
          trend={metrics.uncategorizedSpend > 0 ? "down" : "neutral"}
          trendValue={
            metrics.uncategorizedSpend > 0 ? "needs review" : "all clear"
          }
        />
      )}
    </div>
  );
}
