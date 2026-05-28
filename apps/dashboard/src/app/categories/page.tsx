import AppShell from "@/components/layout/app-shell";
import { canShare } from "@/server/auth/can-share";
import CategoryChart from "@/components/charts/category-chart";
import CategoryFrequencyChart from "@/components/charts/category-frequency-chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import CategoryBadge from "@/components/ui/category-badge";
import { getCategoryColor } from "@/lib/category-colors";
import { parseFilters } from "@/lib/filters";
import { formatCurrency } from "@/lib/currency";
import { getCategoryBreakdown } from "@/server/data/repository";

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
      <h2 className="text-lg font-semibold">No data available</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Run <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">ledgerlift e2e --force</code> to process
        statements and rebuild the database.
      </p>
    </div>
  );
}

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") sp.set(key, value);
    else if (Array.isArray(value)) value.forEach((v) => sp.append(key, v));
  }
  const filters = parseFilters(sp);
  const showShare = await canShare();

  let categories: Awaited<ReturnType<typeof getCategoryBreakdown>>;
  try {
    categories = await getCategoryBreakdown(filters);
  } catch (err) {
    console.error("[categories/page] failed to load:", err);
    return (
      <AppShell canShare={showShare} pageTitle="Categories">
        <EmptyState />
      </AppShell>
    );
  }

  const maxAmount = Math.max(...categories.map((c) => Math.abs(c.amount)), 1);

  return (
    <AppShell canShare={showShare} pageTitle="Categories">
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <CategoryChart data={categories} />
          <CategoryFrequencyChart data={categories} />
        </div>

        <div className="overflow-x-auto">
          <Table className="min-w-[600px]">
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Transactions</TableHead>
                <TableHead className="w-[200px]">Share</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No categories found.
                  </TableCell>
                </TableRow>
              ) : (
                categories.map((cat) => {
                  const color = getCategoryColor(cat.category);
                  return (
                    <TableRow key={cat.category}>
                      <TableCell>
                        <CategoryBadge category={cat.category} />
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCurrency(Math.abs(cat.amount))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cat.count.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-full bg-muted">
                            <div
                              className={`h-2 rounded-full ${color.dot}`}
                              style={{
                                width: `${(Math.abs(cat.amount) / maxAmount) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cat.percentage.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppShell>
  );
}
