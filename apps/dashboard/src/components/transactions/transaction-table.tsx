"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { Transaction } from "@/server/data/types";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/date";
import CategoryBadge from "@/components/ui/category-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

type Column = {
  key: string;
  label: string;
  align?: "left" | "right";
  sortable?: boolean;
  width: string; // fixed CSS width
};

const columns: Column[] = [
  { key: "transaction_date", label: "Date", sortable: true, width: "w-[10%]" },
  { key: "description_normalized", label: "Description", sortable: true, width: "w-[26%]" },
  { key: "merchant_normalized", label: "Merchant", sortable: true, width: "w-[16%]" },
  { key: "category_normalized", label: "Category", sortable: true, width: "w-[16%]" },
  { key: "amount", label: "Amount", align: "right", sortable: true, width: "w-[12%]" },
  { key: "account_name", label: "Account", sortable: true, width: "w-[12%]" },
];

type TransactionTableProps = {
  transactions: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  actions?: (txn: Transaction) => React.ReactNode;
};

export default function TransactionTable({
  transactions,
  total,
  page,
  pageSize,
  sortBy,
  sortDir,
  actions,
}: TransactionTableProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const totalPages = Math.ceil(total / pageSize);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const sortable = sortBy != null;

  function buildHref(overrides: Record<string, string | number>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(overrides)) {
      params.set(k, String(v));
    }
    return `${pathname}?${params.toString()}`;
  }

  function pageHref(targetPage: number) {
    return buildHref({ page: targetPage });
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
      <div className="overflow-x-auto">
      <Table className="table-fixed min-w-[700px]">
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key} className={cn(col.width, col.align === "right" ? "text-right" : "")}>
                {sortable && col.sortable ? (
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
                ) : (
                  col.label
                )}
              </TableHead>
            ))}
            {actions && (
              <TableHead className="w-[8%]" />
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((txn) => (
            <TableRow key={txn.transaction_id}>
              <TableCell className="text-muted-foreground">
                {formatDate(txn.transaction_date)}
              </TableCell>
              <TableCell className="max-w-[240px] truncate font-medium">
                {txn.description_normalized || txn.description_raw}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {txn.merchant_normalized ?? "-"}
              </TableCell>
              <TableCell>
                <CategoryBadge category={txn.category_normalized} />
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-mono tabular-nums",
                  txn.direction === "credit"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                )}
              >
                {txn.direction === "credit" ? "+" : "-"}
                {formatCurrency(Math.abs(txn.amount))}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {txn.account_name}
              </TableCell>
              {actions && (
                <TableCell>{actions(txn)}</TableCell>
              )}
            </TableRow>
          ))}

          {transactions.length === 0 && (
            <TableRow>
              <TableCell colSpan={actions ? 7 : 6} className="h-24 text-center text-muted-foreground">
                No transactions found.
              </TableCell>
            </TableRow>
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
            <Link href={pageHref(page - 1)}>
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
            <Link href={pageHref(page + 1)}>
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
