"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import CategoryBadge from "@/components/ui/category-badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import type { MerchantSummary } from "@/server/data/types";

type MerchantsTableProps = {
  merchants: MerchantSummary[];
  total: number;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: "asc" | "desc";
};

type Column = {
  key: string;
  label: string;
  align?: "left" | "right";
  width: string;
};

const columns: Column[] = [
  { key: "merchant", label: "Merchant", width: "w-[35%]" },
  { key: "category", label: "Category", width: "w-[25%]" },
  { key: "amount", label: "Total Spend", align: "right", width: "w-[22%]" },
  { key: "count", label: "Transactions", align: "right", width: "w-[18%]" },
];

export default function MerchantsTable({
  merchants,
  total,
  page,
  pageSize,
  sortBy,
  sortDir,
}: MerchantsTableProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const totalPages = Math.ceil(total / pageSize);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  function buildHref(overrides: Record<string, string | number>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(overrides)) {
      params.set(k, String(v));
    }
    return `${pathname}?${params.toString()}`;
  }

  function sortHref(column: string) {
    if (sortBy === column) {
      return buildHref({ sortBy: column, sortDir: sortDir === "asc" ? "desc" : "asc", page: 1 });
    }
    return buildHref({ sortBy: column, sortDir: "desc", page: 1 });
  }

  function SortIcon({ column }: { column: string }) {
    if (sortBy !== column) return <ArrowUpDown className="size-3 text-muted-foreground/50" />;
    return sortDir === "asc"
      ? <ArrowUp className="size-3" />
      : <ArrowDown className="size-3" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total.toLocaleString()} merchants
        </p>
      </div>

      <div className="overflow-x-auto">
      <Table className="table-fixed min-w-[600px]">
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key} className={cn(col.width, col.align === "right" ? "text-right" : "")}>
                <Link
                  href={sortHref(col.key)}
                  className={cn(
                    "inline-flex items-center gap-1 hover:text-foreground transition-colors",
                    col.align === "right" && "justify-end"
                  )}
                >
                  {col.label}
                  <SortIcon column={col.key} />
                </Link>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {merchants.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                No merchants found.
              </TableCell>
            </TableRow>
          ) : (
            merchants.map((m) => (
              <TableRow key={m.merchant}>
                <TableCell className="font-medium">{m.merchant}</TableCell>
                <TableCell>
                  {m.category ? (
                    <CategoryBadge category={m.category} />
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatCurrency(Math.abs(m.amount))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {m.count.toLocaleString()}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total > 0
            ? `Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total}`
            : "No results"}
        </p>
        <div className="flex items-center gap-2">
          {hasPrev ? (
            <Link href={buildHref({ page: page - 1 })}>
              <Button variant="outline" size="sm">
                <ChevronLeft className="size-4" />
                Previous
              </Button>
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled>
              <ChevronLeft className="size-4" />
              Previous
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages || 1}
          </span>
          {hasNext ? (
            <Link href={buildHref({ page: page + 1 })}>
              <Button variant="outline" size="sm">
                Next
                <ChevronRight className="size-4" />
              </Button>
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Next
              <ChevronRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
