"use client";

import { useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { HeatmapChart } from "echarts/charts";
import {
  CalendarComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useChartColors } from "@/components/charts/use-chart-colors";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate, formatMonth } from "@/lib/date";
import { formatCurrency } from "@/lib/currency";
import type { CalendarDayPoint } from "@/server/data/types";

echarts.use([
  HeatmapChart,
  CalendarComponent,
  VisualMapComponent,
  TooltipComponent,
  CanvasRenderer,
]);

type Props = {
  data: CalendarDayPoint[];
  year: string;
  month: string;
  metric: "expenses" | "net";
};

type HeatmapPoint = [string, number, number, number];

type EChartsHeatmapParam = {
  data: HeatmapPoint;
  value: HeatmapPoint;
};

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function zeroPad(n: number): string {
  return String(n).padStart(2, "0");
}

// Sign-preserving log so a few outlier days don't flatten the scale; handles net-negative days and zero.
function symlog(x: number): number {
  return Math.sign(x) * Math.log1p(Math.abs(x));
}

function invSymlog(y: number): number {
  return Math.sign(y) * Math.expm1(Math.abs(y));
}

export default function CalendarHeatmap({ data, year, month, metric }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const c = useChartColors();
  const [scale, setScale] = useState<"linear" | "log">("linear");

  const isNet = metric === "net";
  const toColor = scale === "log" ? symlog : (x: number) => x;

  const byDate: Record<string, { value: number; txn_count: number }> = {};
  for (const row of data) {
    byDate[row.date] = { value: row.value, txn_count: row.txn_count };
  }

  const numDays = daysInMonth(Number(year), Number(month));
  const chartData: [string, number, number][] = Array.from({ length: numDays }, (_, i) => {
    const date = `${year}-${month}-${zeroPad(i + 1)}`;
    const row = byDate[date];
    return [date, row?.value ?? 0, row?.txn_count ?? 0];
  });

  // Drop no-transaction days so they render as empty cells instead of pinning the low end of the scale.
  // The 4th dimension carries the color value so the scale transform stays independent of the tooltip amount.
  const seriesData: HeatmapPoint[] = chartData
    .filter((d) => d[2] > 0)
    .map((d) => [d[0], d[1], d[2], toColor(d[1])]);
  const values = seriesData.map((d) => d[1]);
  const hasData = values.length > 0;
  const dataMin = hasData ? Math.min(...values) : 0;
  const dataMax = hasData ? Math.max(...values) : 1;

  // Stretch the scale across this month's actual range so contrast is proportional per month, not anchored at zero.
  const flat = dataMin === dataMax;
  const netExtent = Math.max(Math.abs(dataMin), Math.abs(dataMax), 0.01);
  const rangeMin = isNet ? -netExtent : flat ? dataMin - 1 : dataMin;
  const rangeMax = isNet ? netExtent : dataMax;

  const visualMapColors = isNet
    ? ["#dc2626", "#fca5a5", "#fee2e2", "#bbf7d0", "#16a34a"]
    : ["#fecaca", "#f87171", "#dc2626", "#7f1d1d"];

  const monthStart = `${year}-${month}-01`;
  const monthEnd = `${year}-${month}-${zeroPad(numDays)}`;
  const title = `${metric === "net" ? "Net" : "Expenses"} — ${formatMonth(`${year}-${month}`)}`;

  const option: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    tooltip: {
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      textStyle: { color: c.tooltipText, fontSize: 12 },
      formatter(p: EChartsHeatmapParam) {
        const [date, value, txn_count] = p.data ?? p.value;
        return `<div style="font-weight:600;margin-bottom:4px">${formatDate(date)}</div>
          <div style="font-variant-numeric:tabular-nums">${formatCurrency(value)}</div>
          <div style="color:${c.tooltipMuted};margin-top:2px">${txn_count} transaction${txn_count !== 1 ? "s" : ""}</div>`;
      },
    },
    visualMap: {
      type: "continuous",
      dimension: 3,
      min: toColor(rangeMin),
      max: toColor(rangeMax),
      inRange: { color: visualMapColors },
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      textStyle: { color: c.mutedForeground, fontSize: 11 },
      formatter: (val: number) =>
        formatCurrency(scale === "log" ? invSymlog(val) : val),
    },
    calendar: {
      top: 30,
      left: 30,
      right: 30,
      bottom: 50,
      range: [monthStart, monthEnd],
      cellSize: ["auto", 36],
      itemStyle: {
        borderColor: c.border,
        borderWidth: 1,
        color: "transparent",
      },
      dayLabel: {
        color: c.mutedForeground,
        fontSize: 11,
        firstDay: 1,
      },
      monthLabel: { show: false },
      yearLabel: { show: false },
      splitLine: {
        show: true,
        lineStyle: { color: c.border, width: 1 },
      },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: seriesData,
        emphasis: {
          itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.25)" },
        },
      },
    ],
  };

  function handleClick(param: EChartsHeatmapParam) {
    const date = param.data?.[0] ?? param.value?.[0];
    if (!date) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("day", date);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>{title}</CardTitle>
        <div className="inline-flex items-center gap-1 rounded-lg border border-border p-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setScale("linear")}
            className={cn("rounded-md", scale === "linear" && "bg-muted text-foreground")}
          >
            Linear
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setScale("log")}
            className={cn("rounded-md", scale === "log" && "bg-muted text-foreground")}
          >
            Log
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ReactEChartsCore
          echarts={echarts}
          option={option}
          style={{ height: 220 }}
          notMerge
          opts={{ renderer: "canvas" }}
          onEvents={{ click: handleClick }}
        />
        <p className="mt-1 text-center text-xs text-muted-foreground">
          Click a day to see transactions
        </p>
      </CardContent>
    </Card>
  );
}
