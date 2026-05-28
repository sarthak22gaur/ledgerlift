"use client";

import { useState, useCallback, useMemo, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, X } from "lucide-react";

type DateRangeSliderProps = {
  minDate: string; // "2021-06-15"
  maxDate: string; // "2026-02-28"
};

function toMonthIndex(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return y * 12 + (m - 1);
}

function fromMonthIndex(idx: number): string {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function formatLabel(monthStr: string): string {
  const [y, m] = monthStr.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${y}`;
}

function firstOfMonth(monthStr: string): string {
  return `${monthStr}-01`;
}

function lastOfMonth(monthStr: string): string {
  const [y, m] = monthStr.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${monthStr}-${String(lastDay).padStart(2, "0")}`;
}

export default function DateRangeSlider({ minDate, maxDate }: DateRangeSliderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const minIdx = toMonthIndex(minDate);
  const maxIdx = toMonthIndex(maxDate);

  // Read current range from URL or default to full range
  const currentStart = searchParams.get("startDate");
  const currentEnd = searchParams.get("endDate");

  const startIdx = currentStart ? toMonthIndex(currentStart) : minIdx;
  const endIdx = currentEnd ? toMonthIndex(currentEnd) : maxIdx;

  const [localStart, setLocalStart] = useState(startIdx);
  const [localEnd, setLocalEnd] = useState(endIdx);

  const isFiltered = currentStart || currentEnd;

  const startLabel = useMemo(() => formatLabel(fromMonthIndex(localStart)), [localStart]);
  const endLabel = useMemo(() => formatLabel(fromMonthIndex(localEnd)), [localEnd]);

  const applyRange = useCallback(
    (start: number, end: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (start <= minIdx && end >= maxIdx) {
        // Full range = no filter
        params.delete("startDate");
        params.delete("endDate");
      } else {
        params.set("startDate", firstOfMonth(fromMonthIndex(start)));
        params.set("endDate", lastOfMonth(fromMonthIndex(end)));
      }
      params.delete("page");
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [searchParams, minIdx, maxIdx, pathname, router, startTransition]
  );

  const clearRange = useCallback(() => {
    setLocalStart(minIdx);
    setLocalEnd(maxIdx);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("startDate");
    params.delete("endDate");
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }, [minIdx, maxIdx, searchParams, pathname, router, startTransition]);

  const totalMonths = maxIdx - minIdx;
  if (totalMonths <= 0) return null;

  const startPct = ((localStart - minIdx) / totalMonths) * 100;
  const endPct = ((localEnd - minIdx) / totalMonths) * 100;

  return (
    <Card>
      <CardContent className="pt-2.5 pb-2 px-4">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="size-4 text-muted-foreground" />
            <span className="font-medium">{startLabel}</span>
            <span className="text-muted-foreground">—</span>
            <span className="font-medium">{endLabel}</span>
          </div>
          {isFiltered && (
            <Button variant="ghost" size="sm" onClick={clearRange} className="h-7 gap-1 text-xs text-muted-foreground">
              <X className="size-3" />
              Reset
            </Button>
          )}
        </div>

        {/* Slider track */}
        <div className="relative h-6 flex items-center select-none">
          {/* Background track */}
          <div className="absolute inset-x-0 h-1.5 rounded-full bg-muted" />

          {/* Active range */}
          <div
            className="absolute h-1.5 rounded-full bg-primary"
            style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
          />

          {/* Start thumb */}
          <input
            type="range"
            min={minIdx}
            max={maxIdx}
            value={localStart}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v <= localEnd) {
                setLocalStart(v);
              }
            }}
            onMouseUp={() => { applyRange(localStart, localEnd); }}
            onTouchEnd={() => { applyRange(localStart, localEnd); }}
            className="absolute inset-x-0 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:active:cursor-grabbing [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-grab"
            style={{ zIndex: localStart === localEnd ? 2 : 1 }}
          />

          {/* End thumb */}
          <input
            type="range"
            min={minIdx}
            max={maxIdx}
            value={localEnd}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= localStart) {
                setLocalEnd(v);
              }
            }}
            onMouseUp={() => { applyRange(localStart, localEnd); }}
            onTouchEnd={() => { applyRange(localStart, localEnd); }}
            className="absolute inset-x-0 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:active:cursor-grabbing [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-grab"
            style={{ zIndex: 2 }}
          />
        </div>

        {/* Min/max labels */}
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5 px-0.5">
          <span>{formatLabel(fromMonthIndex(minIdx))}</span>
          <span>{formatLabel(fromMonthIndex(maxIdx))}</span>
        </div>
      </CardContent>
    </Card>
  );
}
