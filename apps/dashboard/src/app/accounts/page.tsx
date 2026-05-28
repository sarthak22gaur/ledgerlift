import AppShell from "@/components/layout/app-shell";
import { canShare } from "@/server/auth/can-share";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { parseFilters } from "@/lib/filters";
import { formatCurrency } from "@/lib/currency";
import { formatInstitution, formatAccountName, formatAccountType } from "@/lib/display-names";
import { getAccountSummary } from "@/server/data/repository";

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

export default async function AccountsPage({
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

  let accounts: Awaited<ReturnType<typeof getAccountSummary>>;
  try {
    accounts = await getAccountSummary(filters);
  } catch (err) {
    console.error("[accounts/page] failed to load:", err);
    return (
      <AppShell canShare={showShare} pageTitle="Accounts">
        <EmptyState />
      </AppShell>
    );
  }

  return (
    <AppShell canShare={showShare} pageTitle="Accounts">
      <div className="space-y-4">
        {accounts.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            No accounts found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <p className="mb-3 text-xs text-muted-foreground">
              Income and Expenses exclude matched internal transfers between your tracked
              accounts. Credit cards additionally exclude payments received from a linked
              bank account. Unmatched transfers (e.g. wires to/from external accounts
              we don&apos;t track, Zelle to other people) still count as real flows.
            </p>
            <Table className="table-fixed min-w-[750px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[22%]">Institution</TableHead>
                  <TableHead className="w-[18%]">Account</TableHead>
                  <TableHead className="w-[12%]">Type</TableHead>
                  <TableHead className="w-[10%] text-right">Transactions</TableHead>
                  <TableHead className="w-[14%] text-right">Income</TableHead>
                  <TableHead className="w-[14%] text-right">Expenses</TableHead>
                  <TableHead className="w-[10%] text-right">Net Flow</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((acct) => {
                  const net = acct.total_income - acct.total_expenses;
                  return (
                    <TableRow key={acct.id}>
                      <TableCell className="font-medium">
                        {formatInstitution(acct.institution)}
                      </TableCell>
                      <TableCell>
                        {formatAccountName(acct.account_name)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {formatAccountType(acct.account_type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {acct.transaction_count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(acct.total_income)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-red-600 dark:text-red-400">
                        {formatCurrency(acct.total_expenses)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono tabular-nums font-medium",
                          net >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        )}
                      >
                        {formatCurrency(net)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
