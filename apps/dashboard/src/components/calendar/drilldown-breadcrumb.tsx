"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { formatMonth } from "@/lib/date";

type BreadcrumbProps = {
  year?: string;
  month?: string;
};

export default function DrilldownBreadcrumb({ year, month }: BreadcrumbProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function buildHref(drop: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of drop) params.delete(key);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const allYearsHref = buildHref(["year", "month"]);
  const yearHref = year ? buildHref(["month"]) : undefined;

  const monthLabel = year && month
    ? formatMonth(`${year}-${month}`)
    : null;

  return (
    <nav aria-label="Drill-down breadcrumb" className="flex items-center gap-1 text-sm">
      {year ? (
        <Link href={allYearsHref} className="text-muted-foreground hover:text-foreground transition-colors">
          All years
        </Link>
      ) : (
        <span className="font-medium">All years</span>
      )}

      {year && (
        <>
          <ChevronRight className="size-3.5 text-muted-foreground" />
          {month ? (
            <Link href={yearHref!} className="text-muted-foreground hover:text-foreground transition-colors">
              {year}
            </Link>
          ) : (
            <span className="font-medium">{year}</span>
          )}
        </>
      )}

      {month && monthLabel && (
        <>
          <ChevronRight className="size-3.5 text-muted-foreground" />
          <span className="font-medium">{monthLabel}</span>
        </>
      )}
    </nav>
  );
}
