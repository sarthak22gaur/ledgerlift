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
import type { SeasonPoint, MonthOfYearPoint } from "@/server/data/types";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

const SEASON_ORDER = ["Winter", "Spring", "Summer", "Autumn"] as const;
type Season = (typeof SEASON_ORDER)[number];

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const SEASON_COLORS: Record<Season, [string, string]> = {
  Winter: ["#93c5fd", "#3b82f6"],
  Spring: ["#86efac", "#22c55e"],
  Summer: ["#fcd34d", "#f59e0b"],
  Autumn: ["#fdba74", "#f97316"],
};

type Props = {
  seasonData: SeasonPoint[];
  moyData: MonthOfYearPoint[];
  metric: "expenses" | "net";
};

type EChartsParam = { dataIndex: number; value: number; name: string };

export default function SeasonPanel({ seasonData, moyData, metric }: Props) {
  const c = useChartColors();

  const isEmpty = seasonData.length === 0 && moyData.length === 0;
  if (isEmpty) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Spending by Season</CardTitle>
          <p className="text-xs text-muted-foreground">
            Meteorological seasons, northern hemisphere.
          </p>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No data available.</p>
        </CardContent>
      </Card>
    );
  }

  const bySeason: Record<string, SeasonPoint> = {};
  for (const d of seasonData) bySeason[d.season] = d;

  const orderedSeasons = SEASON_ORDER.map((s) => ({
    season: s,
    value: bySeason[s]?.value ?? 0,
    txn_count: bySeason[s]?.txn_count ?? 0,
  }));

  const maxSeasonValue = Math.max(...orderedSeasons.map((d) => d.value));
  const maxSeason = orderedSeasons.find((d) => d.value === maxSeasonValue);
  const isNet = metric === "net";

  function seasonBarColor(season: Season, isMax: boolean) {
    const [light, dark] = SEASON_COLORS[season];
    if (isNet) {
      const val = bySeason[season]?.value ?? 0;
      if (val < 0) {
        return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: "#f87171" },
          { offset: 1, color: "#ef4444" },
        ]);
      }
    }
    return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: isMax ? dark : light },
      { offset: 1, color: dark },
    ]);
  }

  const seasonOption: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    grid: { top: 24, right: 16, bottom: 40, left: 64, containLabel: false },
    tooltip: {
      trigger: "axis",
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      textStyle: { color: c.tooltipText, fontSize: 12 },
      formatter(params: EChartsParam | EChartsParam[]) {
        const item = Array.isArray(params) ? params[0] : params;
        const d = orderedSeasons[item.dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${d.season}</div>
          <div style="font-variant-numeric:tabular-nums">${formatCurrency(item.value)}</div>
          <div style="color:${c.tooltipMuted};font-size:11px">${d.txn_count} transactions</div>`;
      },
    },
    xAxis: {
      type: "category",
      data: SEASON_ORDER.map((s) => s),
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
        data: orderedSeasons.map((d) => ({
          value: d.value,
          itemStyle: {
            color: seasonBarColor(
              d.season,
              d.value === maxSeasonValue && maxSeasonValue !== 0
            ),
            borderRadius: [3, 3, 0, 0],
          },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.2)" } },
        })),
        barMaxWidth: 60,
        animationDuration: 600,
        animationEasing: "cubicOut",
      },
    ],
  };

  const byMonth: Record<string, MonthOfYearPoint> = {};
  for (const d of moyData) byMonth[d.month] = d;

  const orderedMonths = Array.from({ length: 12 }, (_, i) => {
    const key = String(i + 1).padStart(2, "0");
    return {
      month: key,
      label: MONTH_LABELS[i],
      value: byMonth[key]?.value ?? 0,
      txn_count: byMonth[key]?.txn_count ?? 0,
    };
  });

  const maxMoyValue = Math.max(...orderedMonths.map((d) => d.value));

  function moyBarColor(value: number, isMax: boolean) {
    if (isNet && value < 0) {
      return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: "#f87171" },
        { offset: 1, color: "#ef4444" },
      ]);
    }
    return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: isMax ? "#dc2626" : "#f87171" },
      { offset: 1, color: isMax ? "#b91c1c" : "#ef4444" },
    ]);
  }

  const moyOption: echarts.EChartsCoreOption = {
    backgroundColor: "transparent",
    grid: { top: 24, right: 16, bottom: 40, left: 64, containLabel: false },
    tooltip: {
      trigger: "axis",
      backgroundColor: c.tooltipBg,
      borderColor: c.tooltipBorder,
      textStyle: { color: c.tooltipText, fontSize: 12 },
      formatter(params: EChartsParam | EChartsParam[]) {
        const item = Array.isArray(params) ? params[0] : params;
        const d = orderedMonths[item.dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${MONTH_LABELS[item.dataIndex]}</div>
          <div style="font-variant-numeric:tabular-nums">${formatCurrency(item.value)}</div>
          <div style="color:${c.tooltipMuted};font-size:11px">${d.txn_count} transactions</div>`;
      },
    },
    xAxis: {
      type: "category",
      data: orderedMonths.map((d) => d.label),
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
        data: orderedMonths.map((d) => ({
          value: d.value,
          itemStyle: {
            color: moyBarColor(d.value, d.value === maxMoyValue && maxMoyValue !== 0),
            borderRadius: [3, 3, 0, 0],
          },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.2)" } },
        })),
        barMaxWidth: 30,
        animationDuration: 600,
        animationEasing: "cubicOut",
      },
    ],
  };

  const headline =
    maxSeason && maxSeasonValue !== 0
      ? `You spend more in ${maxSeason.season}`
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spending by Season &amp; Month</CardTitle>
        <p className="text-xs text-muted-foreground">
          {headline ? `${headline}. ` : ""}
          Meteorological seasons, northern hemisphere (Dec–Feb = Winter, Mar–May = Spring, Jun–Aug = Summer, Sep–Nov = Autumn).
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">By Season</p>
          <ReactEChartsCore
            echarts={echarts}
            option={seasonOption}
            style={{ height: 220 }}
            notMerge
            opts={{ renderer: "canvas" }}
          />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">By Month of Year</p>
          <ReactEChartsCore
            echarts={echarts}
            option={moyOption}
            style={{ height: 220 }}
            notMerge
            opts={{ renderer: "canvas" }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
