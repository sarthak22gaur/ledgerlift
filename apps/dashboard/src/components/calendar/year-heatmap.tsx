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
import { formatDate } from "@/lib/date";
import { formatCurrency } from "@/lib/currency";
import type { CalendarDayPoint } from "@/server/data/types";
import {
  symlog,
  invSymlog,
  buildScaleDomain,
  EXPENSE_COLORS,
  NET_COLORS,
} from "./heatmap-scale";

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
  metric: "expenses" | "net";
};

type HeatmapPoint = [string, number, number, number];

type EChartsHeatmapParam = {
  data: HeatmapPoint;
  value: HeatmapPoint;
};

export default function YearHeatmap({ data, year, metric }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const c = useChartColors();
  const [scale, setScale] = useState<"linear" | "log">("linear");

  const isNet = metric === "net";
  const toColor = scale === "log" ? symlog : (x: number) => x;

  // Drop no-transaction days so they render as empty cells instead of pinning the low end of the scale.
  // The 4th dimension carries the color value so the scale transform stays independent of the tooltip amount.
  const seriesData: HeatmapPoint[] = data
    .filter((d) => d.txn_count > 0)
    .map((d) => [d.date, d.value, d.txn_count, toColor(d.value)]);

  const values = seriesData.map((d) => d[1]);
  // Stretch the scale across this year's actual range so contrast is proportional, not anchored at zero.
  const { rangeMin, rangeMax } = buildScaleDomain(values, isNet);
  const visualMapColors = isNet ? [...NET_COLORS] : [...EXPENSE_COLORS];

  const title = `${metric === "net" ? "Net" : "Expenses"} — ${year}`;

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
      top: 40,
      left: 40,
      right: 20,
      bottom: 50,
      range: year,
      cellSize: [14, 14],
      itemStyle: {
        borderColor: c.border,
        borderWidth: 1,
        color: "transparent",
      },
      dayLabel: {
        color: c.mutedForeground,
        fontSize: 10,
        firstDay: 1,
        nameMap: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
        show: true,
      },
      monthLabel: {
        color: c.mutedForeground,
        fontSize: 11,
      },
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
          style={{ height: 200 }}
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
