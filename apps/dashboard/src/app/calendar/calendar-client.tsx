"use client";

import FilterBar from "@/components/filters/filter-bar";
import MetricToggle from "@/components/calendar/metric-toggle";

interface CalendarClientProps {
  institutions: string[];
  categories: string[];
  metric: "expenses" | "net";
}

export default function CalendarClient({
  institutions,
  categories,
  metric,
}: CalendarClientProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <FilterBar institutions={institutions} categories={categories} />
      <MetricToggle metric={metric} />
    </div>
  );
}
