"use client";

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

type EChartsHeatmapParam = {
  data: [string, number, number]; // [date, value, txn_count]
  value: [string, number, number];
};

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function zeroPad(n: number): string {
  return String(n).padStart(2, "0");
}

export default function CalendarHeatmap({ data, year, month, metric }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const c = useChartColors();

  const isNet = metric === "net";

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

  const values = chartData.map((d) => d[1]);
  const maxVal = Math.max(...values, 0.01);
  const minVal = Math.min(...values, 0);

  const rangeMin = isNet ? Math.min(minVal, 0) : 0;
  const rangeMax = isNet ? Math.max(maxVal, 0) : maxVal;

  const visualMapPieces = isNet
    ? [
        { min: rangeMin, max: 0, color: "#ef4444" },
        { min: 0, max: rangeMax, color: "#10b981" },
      ]
    : undefined;

  const visualMapInRange = isNet
    ? undefined
    : { color: ["#fef3c7", "#ef4444"] };

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
        const sign = isNet && value < 0 ? "" : "";
        return `<div style="font-weight:600;margin-bottom:4px">${formatDate(date)}</div>
          <div style="font-variant-numeric:tabular-nums">${sign}${formatCurrency(value)}</div>
          <div style="color:${c.tooltipMuted};margin-top:2px">${txn_count} transaction${txn_count !== 1 ? "s" : ""}</div>`;
      },
    },
    visualMap: isNet
      ? {
          type: "piecewise",
          pieces: visualMapPieces,
          orient: "horizontal",
          left: "center",
          bottom: 0,
          textStyle: { color: c.mutedForeground, fontSize: 11 },
          itemWidth: 14,
          itemHeight: 10,
          formatter: (val: number) => formatCurrency(val),
        }
      : {
          type: "continuous",
          min: rangeMin,
          max: rangeMax,
          inRange: visualMapInRange,
          orient: "horizontal",
          left: "center",
          bottom: 0,
          textStyle: { color: c.mutedForeground, fontSize: 11 },
          formatter: (val: number) => formatCurrency(val),
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
        data: chartData,
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
      <CardHeader>
        <CardTitle>{title}</CardTitle>
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
