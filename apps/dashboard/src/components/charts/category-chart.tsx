"use client";

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { PieChart } from "echarts/charts";
import {
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { CategoryBreakdown } from "@/server/data/types";
import { formatCurrency } from "@/lib/currency";
import { useChartColors } from "./use-chart-colors";

echarts.use([PieChart, TooltipComponent, LegendComponent, CanvasRenderer]);

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e",
  "#f97316", "#eab308", "#22c55e", "#06b6d4", "#94a3b8",
];

type CategoryChartProps = {
  data: CategoryBreakdown[];
};

type CategoryTooltipParam = {
  color: string;
  name: string;
  value: number;
  data: {
    count: number;
  };
  percent: number;
};

function prepareData(data: CategoryBreakdown[]) {
  const sorted = [...data].sort((a, b) => b.amount - a.amount);
  if (sorted.length <= 8) return sorted;

  const top = sorted.slice(0, 8);
  const rest = sorted.slice(8);
  const otherAmount = rest.reduce((sum, c) => sum + c.amount, 0);
  const otherCount = rest.reduce((sum, c) => sum + c.count, 0);
  const totalAmount = data.reduce((sum, c) => sum + c.amount, 0);

  top.push({
    category: "Other",
    amount: otherAmount,
    count: otherCount,
    percentage: totalAmount > 0 ? (otherAmount / totalAmount) * 100 : 0,
  });
  return top;
}

export default function CategoryChart({ data }: CategoryChartProps) {
  const prepared = prepareData(data);
  const c = useChartColors();

  const option: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      textStyle: { color: c.tooltipText, fontSize: 12 },
      formatter(params: CategoryTooltipParam) {
        const dot = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${params.color};margin-right:6px"></span>`;
        return `<div style="font-weight:600;margin-bottom:4px">${dot}${params.name}</div>
          <div style="font-variant-numeric:tabular-nums">${formatCurrency(params.value)}</div>
          <div style="color:${c.tooltipMuted}">${params.data.count} transactions · ${params.percent.toFixed(1)}%</div>`;
      },
    },
    legend: {
      type: "scroll",
      orient: "horizontal",
      bottom: 0,
      textStyle: { color: c.mutedForeground, fontSize: 11 },
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 14,
    },
    series: [
      {
        type: "pie",
        radius: ["42%", "68%"],
        center: ["50%", "50%"],
        padAngle: 2,
        itemStyle: {
          borderRadius: 4,
        },
        label: { show: false },
        emphasis: {
          scaleSize: 8,
          itemStyle: {
            shadowBlur: 16,
            shadowColor: "rgba(0,0,0,0.3)",
          },
          label: {
            show: true,
            position: "center",
            formatter(params: CategoryTooltipParam) {
              return `{name|${params.name}}\n{value|${formatCurrency(params.value)}}\n{pct|${params.percent.toFixed(1)}%}`;
            },
            rich: {
              name: { fontSize: 14, fontWeight: 600, color: c.foreground, lineHeight: 22 },
              value: { fontSize: 12, color: c.mutedForeground, lineHeight: 20 },
              pct: { fontSize: 11, color: c.dimForeground, lineHeight: 18 },
            },
          },
        },
        data: prepared.map((entry, idx) => ({
          name: entry.category,
          value: entry.amount,
          count: entry.count,
          percentage: entry.percentage,
          itemStyle: { color: COLORS[idx % COLORS.length] },
        })),
        animationType: "scale",
        animationDuration: 800,
        animationEasing: "cubicOut",
      },
    ],
  };

  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">Spending by Category</h3>
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
