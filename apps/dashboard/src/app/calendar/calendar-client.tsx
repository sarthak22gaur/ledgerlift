"use client";

import FilterBar from "@/components/filters/filter-bar";

interface CalendarClientProps {
  institutions: string[];
  categories: string[];
}

export default function CalendarClient({
  institutions,
  categories,
}: CalendarClientProps) {
  return <FilterBar institutions={institutions} categories={categories} />;
}
