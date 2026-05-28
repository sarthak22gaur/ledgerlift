"use client";

import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { CashflowSeries } from "@/server/data/types";
import { formatCurrency, formatCompactCurrency } from "@/lib/currency";
import { formatMonth } from "@/lib/date";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useChartColors } from "./use-chart-colors";

echarts.use([
  BarChart, LineChart, GridComponent, TooltipComponent,
  LegendComponent, DataZoomComponent, CanvasRenderer,
]);

type CashflowChartProps = {
  data: CashflowSeries[];
};

type AxisTooltipParam = {
  axisValue: string;
  color: string;
  seriesName: string;
  value: number;
};

export default function CashflowChart({ data }: CashflowChartProps) {
  const months = data.map((d) => d.month);
  const showSlider = data.length > 18;
  const sliderStart = showSlider ? Math.round(((data.length - 18) / data.length) * 100) : 0;
  const c = useChartColors();

  const option: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    grid: {
      top: 40,
      right: 16,
      bottom: showSlider ? 80 : 40,
      left: 60,
      containLabel: false,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      textStyle: { color: c.tooltipText, fontSize: 12 },
      formatter(params: AxisTooltipParam | AxisTooltipParam[]) {
        const items = Array.isArray(params) ? params : [params];
        const month = formatMonth(items[0].axisValue);
        let html = `<div style="font-weight:600;margin-bottom:6px">${month}</div>`;
        for (const item of items) {
          const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color};margin-right:6px"></span>`;
          html += `<div style="display:flex;justify-content:space-between;gap:16px;line-height:1.6">
            <span>${dot}${item.seriesName}</span>
            <span style="font-weight:500;font-variant-numeric:tabular-nums">${formatCurrency(item.value)}</span>
          </div>`;
        }
        return html;
      },
    },
    legend: {
      bottom: showSlider ? 44 : 0,
      textStyle: { color: c.mutedForeground, fontSize: 11 },
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 16,
    },
    xAxis: {
      type: "category",
      data: months,
      axisLabel: {
        formatter: (v: string) => formatMonth(v),
        color: c.mutedForeground,
        fontSize: 11,
      },
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
    dataZoom: showSlider
      ? [
          {
            type: "slider",
            start: sliderStart,
            end: 100,
            height: 24,
            bottom: 20,
            borderColor: c.border,
            backgroundColor: "transparent",
            fillerColor: "rgba(99,102,241,0.15)",
            handleStyle: { color: "#6366f1", borderColor: "#6366f1" },
            textStyle: { color: c.mutedForeground, fontSize: 11 },
            dataBackground: {
              lineStyle: { color: "rgba(99,102,241,0.3)" },
              areaStyle: { color: "rgba(99,102,241,0.08)" },
            },
          },
        ]
      : [],
    series: [
      {
        name: "Income",
        type: "bar",
        data: data.map((d) => d.income),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "#34d399" },
            { offset: 1, color: "#10b981" },
          ]),
          borderRadius: [3, 3, 0, 0],
        },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(16,185,129,0.4)" } },
        barMaxWidth: 18,
        animationDuration: 800,
        animationEasing: "cubicOut",
      },
      {
        name: "Expenses",
        type: "bar",
        data: data.map((d) => d.expenses),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "#f87171" },
            { offset: 1, color: "#ef4444" },
          ]),
          borderRadius: [3, 3, 0, 0],
        },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(239,68,68,0.4)" } },
        barMaxWidth: 18,
        animationDuration: 800,
        animationEasing: "cubicOut",
        animationDelay: 200,
      },
      {
        name: "Net",
        type: "line",
        data: data.map((d) => d.net),
        smooth: true,
        symbol: "circle",
        symbolSize: 4,
        showSymbol: false,
        lineStyle: { width: 2.5, color: "#60a5fa" },
        itemStyle: { color: "#60a5fa" },
        emphasis: {
          scale: true,
          itemStyle: { borderWidth: 2, borderColor: "#60a5fa" },
        },
        animationDuration: 1200,
        animationEasing: "cubicOut",
        animationDelay: 400,
      },
    ],
    animationDuration: 800,
    animationEasing: "cubicOut",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly Cashflow</CardTitle>
      </CardHeader>
      <CardContent>
        <ReactEChartsCore
          echarts={echarts}
          option={option}
          style={{ height: showSlider ? 380 : 320 }}
          notMerge
          opts={{ renderer: "canvas" }}
        />
      </CardContent>
    </Card>
  );
}
