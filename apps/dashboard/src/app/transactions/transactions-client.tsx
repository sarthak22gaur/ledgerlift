"use client";

import FilterBar from "@/components/filters/filter-bar";

interface TransactionsClientProps {
  institutions: string[];
  categories: string[];
}

export default function TransactionsClient({
  institutions,
  categories,
}: TransactionsClientProps) {
  return (
    <FilterBar institutions={institutions} categories={categories} />
  );
}
