import type { Transaction } from "@/server/data/types";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

type TransactionDetailProps = {
  transaction: Transaction;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default function TransactionDetail({ transaction: txn }: TransactionDetailProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <span className="truncate">
            {txn.description_normalized || txn.description_raw}
          </span>
          <Badge variant={txn.direction === "credit" ? "default" : "destructive"}>
            {txn.direction}
          </Badge>
          <Badge variant="secondary">{txn.transaction_type}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Amount">
            <span
              className={cn(
                "text-lg font-semibold tabular-nums",
                txn.direction === "credit"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              )}
            >
              {txn.direction === "credit" ? "+" : "-"}
              {formatCurrency(Math.abs(txn.amount))}
            </span>
          </Field>

          <Field label="Transaction Date">{formatDate(txn.transaction_date)}</Field>
          <Field label="Posted Date">{formatDate(txn.posted_date)}</Field>

          <Field label="Merchant">{txn.merchant_normalized ?? "Unknown"}</Field>
          <Field label="Category">
            {txn.category_normalized ? (
              <Badge variant="secondary">{txn.category_normalized}</Badge>
            ) : (
              <Badge variant="outline">Uncategorized</Badge>
            )}
          </Field>
          <Field label="Subcategory">{txn.subcategory_normalized ?? "-"}</Field>

          <Field label="Account">{txn.account_name}</Field>
          <Field label="Institution">{txn.institution}</Field>
          <Field label="Account Type">{txn.account_type}</Field>

          <Field label="Description (Raw)">{txn.description_raw}</Field>
          <Field label="Currency">{txn.currency}</Field>
          <Field label="Reference #">{txn.reference_number ?? "-"}</Field>
        </div>

        <Separator className="my-6" />

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Statement Period">
            {formatDate(txn.statement_start_date)} - {formatDate(txn.statement_end_date)}
          </Field>
          <Field label="Parser">
            {txn.parser_name} v{txn.parser_version}
          </Field>
          <Field label="Imported">
            {txn.import_timestamp ? formatDate(txn.import_timestamp) : "-"}
          </Field>

          <Field label="Transfer Candidate">
            {txn.is_transfer_candidate ? "Yes" : "No"}
          </Field>
          <Field label="Internal Payment Candidate">
            {txn.is_internal_payment_candidate ? "Yes" : "No"}
          </Field>
          <Field label="Enriched At">
            {txn.enriched_at ? formatDate(txn.enriched_at) : "Not enriched"}
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}
