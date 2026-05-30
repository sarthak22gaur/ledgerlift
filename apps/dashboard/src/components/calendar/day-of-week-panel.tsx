"use client";

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useChartColors } from "@/components/charts/use-chart-colors";
import { formatCurrency, formatCompactCurrency } from "@/lib/currency";
import type { DayOfWeekPoint } from "@/server/data/types";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

// strftime('%w') returns '0'=Sun...'6'=Sat; reorder to Mon-first for display
const DOW_ORDER = ["1", "2", "3", "4", "5", "6", "0"] as const;
const DOW_LABELS: Record<string, string> = {
  "0": "Sun",
  "1": "Mon",
  "2": "Tue",
  "3": "Wed",
  "4": "Thu",
  "5": "Fri",
  "6": "Sat",
};
const DOW_FULL: Record<string, string> = {
  "0": "Sunday",
  "1": "Monday",
  "2": "Tuesday",
  "3": "Wednesday",
  "4": "Thursday",
  "5": "Friday",
  "6": "Saturday",
};

type Props = {
  data: DayOfWeekPoint[];
  metric: "expenses" | "net";
};

type EChartsParam = { dataIndex: number; value: number };

export default function DayOfWeekPanel({ data, metric }: Props) {
  const c = useChartColors();

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Spending by Day of Week</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No data available.</p>
        </CardContent>
      </Card>
    );
  }

  const byDow: Record<string, DayOfWeekPoint> = {};
  for (const d of data) byDow[d.dow] = d;

  const ordered = DOW_ORDER.map((dow) => ({
    dow,
    label: DOW_LABELS[dow],
    value: byDow[dow]?.value ?? 0,
    txn_count: byDow[dow]?.txn_count ?? 0,
    avg_value: byDow[dow]?.avg_value ?? 0,
  }));

  const maxValue = Math.max(...ordered.map((d) => d.value));
  const maxDow = ordered.find((d) => d.value === maxValue);
  const isNet = metric === "net";

  function barColor(value: number, isMax: boolean) {
    if (isNet) {
      if (value >= 0) {
        return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: isMax ? "#10b981" : "#34d399" },
          { offset: 1, color: isMax ? "#059669" : "#10b981" },
        ]);
      }
      return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: isMax ? "#dc2626" : "#f87171" },
        { offset: 1, color: isMax ? "#b91c1c" : "#ef4444" },
      ]);
    }
    return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: isMax ? "#dc2626" : "#f87171" },
      { offset: 1, color: isMax ? "#b91c1c" : "#ef4444" },
    ]);
  }

  const option: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    grid: { top: 24, right: 16, bottom: 40, left: 64, containLabel: false },
    tooltip: {
      trigger: "axis",
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      textStyle: { color: c.tooltipText, fontSize: 12 },
      formatter(params: EChartsParam | EChartsParam[]) {
        const item = Array.isArray(params) ? params[0] : params;
        const d = ordered[item.dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${DOW_FULL[d.dow]}</div>
          <div style="font-variant-numeric:tabular-nums">${formatCurrency(item.value)}</div>
          <div style="color:${c.tooltipMuted};font-size:11px">${d.txn_count} transactions</div>`;
      },
    },
    xAxis: {
      type: "category",
      data: ordered.map((d) => d.label),
      axisLabel: { color: c.mutedForeground, fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: (v: number) => formatCompactCurrency(v),
        color: c.mutedForeground,
        fontSize: 11,
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: c.border } },
    },
    series: [
      {
        type: "bar",
        data: ordered.map((d) => ({
          value: d.value,
          itemStyle: {
            color: barColor(d.value, d.value === maxValue && maxValue !== 0),
            borderRadius: [3, 3, 0, 0],
          },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.2)" } },
        })),
        barMaxWidth: 40,
        animationDuration: 600,
        animationEasing: "cubicOut",
      },
    ],
  };

  const headline =
    maxDow && maxValue !== 0
      ? `You spend more on ${DOW_FULL[maxDow.dow]}s`
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spending by Day of Week</CardTitle>
        {headline && (
          <p className="text-sm text-muted-foreground">{headline}</p>
        )}
      </CardHeader>
      <CardContent>
        <ReactEChartsCore
          echarts={echarts}
          option={option}
          style={{ height: 260 }}
          notMerge
          opts={{ renderer: "canvas" }}
        />
      </CardContent>
    </Card>
  );
}
