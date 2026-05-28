import AppShell from "@/components/layout/app-shell";
import { canShare } from "@/server/auth/can-share";
import { parseFilters } from "@/lib/filters";
import { getTransferPairs, getTransferCandidates } from "@/server/data/repository";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/date";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowRightLeft, CircleAlert } from "lucide-react";
import TransactionTable from "@/components/transactions/transaction-table";

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

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 0.95) return <Badge variant="secondary">Exact</Badge>;
  if (confidence >= 0.85) return <Badge variant="secondary">High</Badge>;
  return <Badge variant="outline">Moderate</Badge>;
}

async function loadTransfersData(filters: ReturnType<typeof parseFilters>, page: number) {
  const [pairs, unmatched] = await Promise.all([
    getTransferPairs(filters),
    getTransferCandidates(filters, page, 50),
  ]);

  return { pairs, unmatched };
}

export default async function TransfersPage({
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
  const page = Math.max(1, Number(params.page) || 1);
  const showShare = await canShare();

  let data: Awaited<ReturnType<typeof loadTransfersData>>;
  try {
    data = await loadTransfersData(filters, page);
  } catch (err) {
    console.error("[review/transfers/page] failed to load:", err);
    return (
      <AppShell canShare={showShare} pageTitle="Transfers">
        <EmptyState />
      </AppShell>
    );
  }

  const { pairs, unmatched } = data;
  const ccPaymentPairs = pairs.filter((p) => p.is_internal_payment);
  const totalEliminated = pairs.reduce((sum, p) => sum + p.amount, 0);

  // The query already filters to unpaired candidates; trust the total
  // (data is just the current page slice).
  const unmatchedData = unmatched.data;
  const unmatchedTotal = unmatched.total;

  return (
    <AppShell canShare={showShare} pageTitle="Transfers">
      <div className="space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Matched Pairs
                </p>
                <p className="text-2xl font-semibold">{pairs.length}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(totalEliminated)} eliminated
                </p>
              </div>
              <div className="rounded-lg bg-muted p-2">
                <ArrowRightLeft className="size-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  CC Payments
                </p>
                <p className="text-2xl font-semibold">{ccPaymentPairs.length}</p>
                <p className="text-xs text-muted-foreground">both sides excluded</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Unmatched Candidates
                </p>
                <p className="text-2xl font-semibold">{unmatchedTotal}</p>
                <p className="text-xs text-muted-foreground">
                  {unmatchedTotal > 0 ? "review recommended" : "all matched"}
                </p>
              </div>
              {unmatchedTotal > 0 && (
                <div className="rounded-lg bg-muted p-2">
                  <CircleAlert className="size-5 text-amber-500" />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tabbed lists: Unmatched (actionable) by default, Matched for audit */}
        {(pairs.length > 0 || unmatchedTotal > 0) && (
          <Tabs defaultValue={unmatchedTotal > 0 ? "unmatched" : "matched"}>
            <TabsList>
              <TabsTrigger value="unmatched">
                Unmatched ({unmatchedTotal})
              </TabsTrigger>
              <TabsTrigger value="matched">
                Matched ({pairs.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="unmatched">
              {unmatchedTotal === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    All transfer candidates were matched. Nothing to review.
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Unmatched Transfer Candidates</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="mb-4 text-sm text-muted-foreground">
                      These transactions look like transfers but couldn&apos;t be matched to a
                      counterpart. They may need manual review or rule adjustments.
                    </p>
                    <TransactionTable
                      transactions={unmatchedData.slice(0, 50)}
                      total={unmatchedTotal}
                      page={1}
                      pageSize={50}
                    />
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="matched">
              {pairs.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    No matched pairs yet.
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Matched Transfer Pairs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table className="min-w-[650px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>From Account</TableHead>
                            <TableHead>To Account</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Confidence</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pairs.map((pair) => {
                            const fromAcct = pair.direction1 === "debit" ? pair.account1 : pair.account2;
                            const toAcct = pair.direction1 === "debit" ? pair.account2 : pair.account1;
                            const fromDate = pair.direction1 === "debit" ? pair.date1 : pair.date2;

                            return (
                              <TableRow key={pair.transfer_pair_id}>
                                <TableCell className="text-muted-foreground">
                                  {formatDate(fromDate)}
                                  {pair.date1 !== pair.date2 && (
                                    <span className="ml-1 text-xs text-muted-foreground/60">
                                      +{Math.abs(
                                        Math.round(
                                          (new Date(pair.date2).getTime() - new Date(pair.date1).getTime()) /
                                            86400000
                                        )
                                      )}d
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="font-mono tabular-nums font-medium">
                                  {formatCurrency(pair.amount)}
                                </TableCell>
                                <TableCell>{fromAcct}</TableCell>
                                <TableCell>{toAcct}</TableCell>
                                <TableCell>
                                  {pair.is_internal_payment ? (
                                    <Badge variant="secondary">CC Payment</Badge>
                                  ) : (
                                    <Badge variant="outline">Transfer</Badge>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <ConfidenceBadge confidence={pair.confidence} />
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
          )}
      </div>
    </AppShell>
  );
}
