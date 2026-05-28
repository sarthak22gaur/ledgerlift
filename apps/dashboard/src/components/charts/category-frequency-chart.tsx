"use client";

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { CategoryBreakdown } from "@/server/data/types";
import { formatCurrency } from "@/lib/currency";
import { useChartColors } from "./use-chart-colors";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

// Same palette as category-chart.tsx
const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#eab308", "#22c55e", "#06b6d4", "#94a3b8",
];

type Props = {
  data: CategoryBreakdown[];
};

type AxisTooltipParam = {
  dataIndex: number;
  name: string;
  value: number;
};

export default function CategoryFrequencyChart({ data }: Props) {
  const c = useChartColors();

  // Sort by count descending, take top 10
  const sorted = [...data].sort((a, b) => b.count - a.count).slice(0, 10);
  // Reverse for horizontal bar (bottom-to-top)
  const items = [...sorted].reverse();

  const option: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    grid: {
      top: 8,
      right: 16,
      bottom: 8,
      left: 8,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      textStyle: { color: c.tooltipText, fontSize: 12 },
      formatter(params: AxisTooltipParam | AxisTooltipParam[]) {
        const item = Array.isArray(params) ? params[0] : params;
        const cat = items[item.dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${item.name}</div>
          <div>${item.value} transactions</div>
          <div style="color:${c.tooltipMuted}">${formatCurrency(cat.amount)} total spend</div>`;
      },
    },
    xAxis: {
      type: "value",
      axisLabel: { color: c.mutedForeground, fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: c.border } },
    },
    yAxis: {
      type: "category",
      data: items.map((d) => d.category),
      axisLabel: { color: c.mutedForeground, fontSize: 11, width: 100, overflow: "truncate" },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        data: items.map((d, idx) => ({
          value: d.count,
          itemStyle: {
            color: COLORS[(items.length - 1 - idx) % COLORS.length],
            borderRadius: [0, 3, 3, 0],
          },
        })),
        barMaxWidth: 20,
        emphasis: {
          itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.2)" },
        },
        animationDuration: 800,
        animationEasing: "cubicOut",
      },
    ],
  };

  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">Most Frequent Categories</h3>
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height: 340 }}
        notMerge
        opts={{ renderer: "canvas" }}
      />
    </div>
  );
}
