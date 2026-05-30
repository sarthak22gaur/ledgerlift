"use client";

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useChartColors } from "@/components/charts/use-chart-colors";
import { formatCurrency, formatCompactCurrency } from "@/lib/currency";
import { formatMonth } from "@/lib/date";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

type YearPoint = { year: string; value: number };
type MonthPoint = { month: string; value: number };

type DrilldownChartProps =
  | { mode: "year"; data: YearPoint[]; metric: "expenses" | "net" }
  | { mode: "month"; data: MonthPoint[]; metric: "expenses" | "net"; year: string };

type EChartsParam = { dataIndex: number; name: string; value: number };

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function zeroFillMonths(data: MonthPoint[]): number[] {
  const byMonth: Record<string, number> = {};
  for (const d of data) byMonth[d.month] = d.value;
  return Array.from({ length: 12 }, (_, i) => {
    const key = String(i + 1).padStart(2, "0");
    return byMonth[key] ?? 0;
  });
}

export default function DrilldownChart(props: DrilldownChartProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const c = useChartColors();

  const isEmpty = props.data.length === 0;

  function buildHref(overrides: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(overrides)) params.set(k, v);
    return `${pathname}?${params.toString()}`;
  }

  const isNet = props.metric === "net";

  function barColor(value: number) {
    if (isNet) {
      return value >= 0
        ? new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "#34d399" },
            { offset: 1, color: "#10b981" },
          ])
        : new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "#f87171" },
            { offset: 1, color: "#ef4444" },
          ]);
    }
    return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: "#f87171" },
      { offset: 1, color: "#ef4444" },
    ]);
  }

  let categories: string[];
  let values: number[];
  let title: string;

  if (props.mode === "year") {
    categories = props.data.map((d) => d.year);
    values = props.data.map((d) => d.value);
    title = props.metric === "net" ? "Net by Year" : "Expenses by Year";
  } else {
    categories = MONTH_LABELS;
    values = zeroFillMonths(props.data);
    title = props.metric === "net"
      ? `Net by Month — ${props.year}`
      : `Expenses by Month — ${props.year}`;
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
        const label =
          props.mode === "year"
            ? item.name
            : formatMonth(`${(props as { year: string }).year}-${String(item.dataIndex + 1).padStart(2, "0")}`);
        return `<div style="font-weight:600;margin-bottom:4px">${label}</div>
          <div style="font-variant-numeric:tabular-nums">${formatCurrency(item.value)}</div>`;
      },
    },
    xAxis: {
      type: "category",
      data: categories,
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
        data: values.map((v) => ({
          value: v,
          itemStyle: { color: barColor(v), borderRadius: [3, 3, 0, 0] },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.2)" } },
        })),
        barMaxWidth: 40,
        animationDuration: 600,
        animationEasing: "cubicOut",
      },
    ],
  };

  function handleClick(param: EChartsParam) {
    if (props.mode === "year") {
      const year = props.data[param.dataIndex]?.year;
      if (year) router.push(buildHref({ year }));
    } else {
      const month = String(param.dataIndex + 1).padStart(2, "0");
      router.push(buildHref({ month }));
    }
  }

  if (isEmpty) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            No transactions for this period.
          </p>
        </CardContent>
      </Card>
    );
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
          style={{ height: 300 }}
          notMerge
          opts={{ renderer: "canvas" }}
          onEvents={{ click: handleClick }}
        />
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Click a bar to drill down
        </p>
      </CardContent>
    </Card>
  );
}
