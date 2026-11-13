import Link from "next/link";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Layers3, Wallet } from "lucide-react";
import KpiCard from "@/components/dashboard/kpi-card";
import CategoryBadge from "@/components/ui/category-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/currency";
import { filtersToSearchParams } from "@/lib/filters";
import { monthlyTransactionUrl, monthlyUrl, nonDateFilters } from "@/lib/monthly";
import type { MonthlyCategory, MonthlyOverview } from "@/server/data/types";

export function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
}

function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

function signedCurrency(amount: number) {
  return `${amount > 0 ? "+" : ""}${formatCurrency(amount)}`;
}

function PriorChange({ category }: { category: MonthlyCategory }) {
  if (category.previousDifference === null) return <span className="text-xs text-muted-foreground">No imported data</span>;
  return (
    <div className="space-y-0.5">
      <div className="font-mono tabular-nums">{signedCurrency(category.previousDifference)}</div>
      <div className="text-xs text-muted-foreground">
        {category.isNew ? "New" : category.previousPercent === null ? "—" : `${category.previousPercent > 0 ? "+" : ""}${category.previousPercent.toFixed(1)}%`}
      </div>
    </div>
  );
}

export function MonthlyScope({ data }: { data: MonthlyOverview }) {
  const labels: Record<string, string> = { institutions: "Institution", accounts: "Account", categories: "Category", merchants: "Merchant", direction: "Direction", minAmount: "Minimum amount", maxAmount: "Maximum amount", search: "Search", uncategorizedOnly: "Uncategorized only", transferCandidatesOnly: "Transfer candidates only" };
  const active = [...filtersToSearchParams(nonDateFilters(data.filters)).entries()];
  if (!active.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Active monthly filters">
      <span className="font-medium text-muted-foreground">Filtered view</span>
      {active.map(([key, value]) => <span key={key} className="max-w-full break-words rounded-md bg-muted px-2 py-1">{labels[key] ?? key}: {value}</span>)}
      <Link href={monthlyUrl(data.month, {})} className="rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">Clear filters</Link>
    </div>
  );
}

export default function MonthlyView({ data }: { data: MonthlyOverview }) {
  const { month, filters, categories } = data;
  const comparisonLabel = data.comparisonDay === null ? "Full calendar-month comparisons" : `Comparisons through day ${data.comparisonDay}`;
  const largest = categories.find((category) => category.amount > 0);
  const increases = categories.filter((category) => !category.isNew && (category.previousDifference ?? 0) > 0).sort((a, b) => b.previousDifference! - a.previousDifference!).slice(0, 3);
  const newCategories = categories.filter((category) => category.isNew).slice(0, 3);
  const hasPriorData = categories.some((category) => category.previousAmount !== null);
  const needsComparisonAmount = categories.some((category) => Math.abs(category.amount - category.comparisonAmount) > 0.005);
  const categoryLink = (category: string) => monthlyTransactionUrl(month, filters, { category });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{dateLabel(data.startDate)} – {dateLabel(data.endDate)}</span>
          <span>{data.transactionCount.toLocaleString()} imported transaction{data.transactionCount === 1 ? "" : "s"}</span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">Spending is grouped by transaction date. Early payments appear in the month paid.</p>
        <p className="text-xs leading-relaxed text-muted-foreground">Latest imported transaction in this scope: {data.latestImportedDate ? dateLabel(data.latestImportedDate) : "none"}. Results reflect imported transactions and may omit statements.</p>
      </div>
      <MonthlyScope data={data} />

      {data.transactionCount === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center">
          <h2 className="text-lg font-semibold">No imported transactions for {monthLabel(month)}</h2>
          <p className="mt-2 text-sm text-muted-foreground">Choose another month or adjust the institution and account filters. An empty month does not establish zero spending.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard title="Category spending" value={formatCurrency(data.categorySpending)} subtitle="Debit spending by category" icon={Layers3} />
            <KpiCard title="Income & other inflows" value={formatCurrency(data.metrics.totalIncome)} subtitle="Excludes inbound reimbursements" icon={ArrowDownLeft} />
            <KpiCard title="Cash outflow after reimbursements" value={formatCurrency(data.metrics.totalExpenses)} subtitle="Cashflow expense measure" icon={ArrowUpRight} />
            <KpiCard title="Net cashflow" value={formatCurrency(data.metrics.netCashflow)} subtitle="Inflows less cash outflow" icon={Wallet} />
          </div>

          <details className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-ring">How these totals are calculated</summary>
            <div className="mt-3 max-w-4xl space-y-2 text-xs leading-relaxed text-muted-foreground">
              <p>Category spending adds debit amounts. Positive refunds do not reduce it; they follow the existing inflow calculation. Inbound reimbursements reduce cash outflow rather than income, and outbound reimbursements remain spending.</p>
              <p>Matched transfers and internal sweeps are excluded. Transfers and Credit Card Payment categories are also excluded from category spending, while unmatched external debits can still affect cashflow. Orphan card-payment credits are excluded from income. Uncategorized spending stays in the total.</p>
              <p>Transaction links show month-scoped debit rows with the displayed filters. The transaction list can also show transfer or payment rows excluded from these spending totals.</p>
            </div>
          </details>

          <Card>
            <CardHeader>
              <CardTitle><h2>Spending by category</h2></CardTitle>
              <CardDescription>{comparisonLabel}. {data.comparisonDay !== null ? "Each earlier month is capped at the same day or its month end." : "Compared with the preceding month and preceding three months."}</CardDescription>
              <p className="text-xs leading-relaxed text-muted-foreground">Amount and share include all imported spending in the selected month. Missing comparison months show “No imported data”; the three-month average requires data in all three windows. Aligned dates do not establish complete account coverage.</p>
            </CardHeader>
            <CardContent>
              <Table className="min-w-[760px]" aria-label="Monthly category spending comparison">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Category</TableHead>
                    <TableHead scope="col" className="text-right">Amount</TableHead>
                    <TableHead scope="col" className="text-right">Share</TableHead>
                    <TableHead scope="col" className="text-right">Transactions</TableHead>
                    {needsComparisonAmount && <TableHead scope="col" className="text-right">Through day {data.comparisonDay}</TableHead>}
                    <TableHead scope="col" className="text-right">Change vs prior month</TableHead>
                    <TableHead scope="col" className="text-right">Prior 3-month average</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.length === 0 ? <TableRow><TableCell colSpan={needsComparisonAmount ? 7 : 6} className="py-10 text-center text-muted-foreground">No category debit spending in this month and scope.</TableCell></TableRow> : categories.map((category) => (
                    <TableRow key={category.category}>
                      <TableCell><Link href={categoryLink(category.category)} className="inline-flex rounded-full outline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" aria-label={`View ${category.category} debit transactions`}><CategoryBadge category={category.category} /></Link></TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatCurrency(category.amount)}</TableCell>
                      <TableCell><div className="flex items-center justify-end gap-2"><div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted md:block" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{ width: `${category.percentage}%` }} /></div><span className="w-12 text-right tabular-nums">{category.percentage.toFixed(1)}%</span></div></TableCell>
                      <TableCell className="text-right tabular-nums">{category.count.toLocaleString()}</TableCell>
                      {needsComparisonAmount && <TableCell className="text-right font-mono tabular-nums">{formatCurrency(category.comparisonAmount)}</TableCell>}
                      <TableCell className="text-right"><PriorChange category={category} /></TableCell>
                      <TableCell className="text-right">{category.threeMonthAverage === null ? <span className="text-xs text-muted-foreground">No imported data</span> : <span className="font-mono tabular-nums">{formatCurrency(category.threeMonthAverage)}</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle><h2>What changed</h2></CardTitle><CardDescription>{comparisonLabel}; changes describe imported spending.</CardDescription></CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-3">
              <div className="space-y-2"><h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Largest spending category</h3>{largest ? <><Link href={categoryLink(largest.category)} className="font-medium hover:underline">{largest.category}</Link><p className="text-2xl font-semibold tracking-tight">{formatCurrency(largest.amount)}</p><p className="text-xs text-muted-foreground">{largest.percentage.toFixed(1)}% of selected-month category spending</p></> : <p className="text-sm text-muted-foreground">No category debit spending.</p>}</div>
              <div className="space-y-2"><h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Largest increases</h3>{increases.length ? <ul className="space-y-2">{increases.map((category) => <li key={category.category} className="flex items-start justify-between gap-3 text-sm"><Link href={categoryLink(category.category)} className="hover:underline">{category.category}</Link><span className="shrink-0 font-mono tabular-nums">{signedCurrency(category.previousDifference!)}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">{hasPriorData ? "No increases among previously active categories." : "No imported data for the prior month."}</p>}</div>
              <div className="space-y-2"><h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">New this comparison</h3>{newCategories.length ? <ul className="space-y-2">{newCategories.map((category) => <li key={category.category} className="flex items-start justify-between gap-3 text-sm"><Link href={categoryLink(category.category)} className="hover:underline">{category.category}</Link><span className="shrink-0 font-mono tabular-nums">{formatCurrency(category.comparisonAmount)}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">{hasPriorData ? "No newly appearing category spending." : "A prior-month baseline is needed."}</p>}<p className="text-xs text-muted-foreground">New means spending with no debit spending in the prior comparison window.</p></div>
            </CardContent>
          </Card>

          {data.merchants.length > 0 && <Card>
            <CardHeader><CardTitle><h2>Top merchants</h2></CardTitle><CardDescription>Selected-month debit spending, with the same spending exclusions.</CardDescription></CardHeader>
            <CardContent><ul className="divide-y">{data.merchants.slice(0, 5).map((merchant) => <li key={merchant.merchant}><Link href={monthlyTransactionUrl(month, filters, { merchant: merchant.merchant })} className="flex items-center justify-between gap-4 rounded-md py-3 text-sm outline-offset-2 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"><span className="min-w-0"><span className="block truncate font-medium">{merchant.merchant}</span><span className="text-xs text-muted-foreground">{merchant.count.toLocaleString()} transaction{merchant.count === 1 ? "" : "s"}</span></span><span className="flex shrink-0 items-center gap-3"><span className="font-mono tabular-nums">{formatCurrency(Math.abs(merchant.amount))}</span><ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" /></span></Link></li>)}</ul></CardContent>
          </Card>}
        </>
      )}
    </div>
  );
}
