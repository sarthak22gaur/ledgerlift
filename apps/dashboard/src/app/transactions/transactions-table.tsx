"use client";

import TransactionTable from "@/components/transactions/transaction-table";
import { CreateRuleDialog } from "@/components/rules/create-rule-dialog";
import { Button } from "@/components/ui/button";
import type { Transaction } from "@/server/data/types";

type Props = {
  transactions: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

export default function TransactionsTable({
  transactions,
  total,
  page,
  pageSize,
  sortBy,
  sortDir,
}: Props) {
  function actions(txn: Transaction) {
    return (
      <div className="flex items-center gap-1">
        <CreateRuleDialog
          mode={{
            kind: "merchant-rule",
            initial: {
              match: {
                type: "contains",
                pattern: txn.description_normalized || txn.description_raw,
              },
              canonical_merchant: "",
            },
          }}
          trigger={
            <Button size="sm" variant="outline" className="text-xs">
              Rule
            </Button>
          }
        />
        <CreateRuleDialog
          mode={{
            kind: "merchant-override",
            initial: {
              transaction_id: txn.transaction_id,
            },
          }}
          trigger={
            <Button size="sm" variant="outline" className="text-xs">
              Override
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <TransactionTable
      transactions={transactions}
      total={total}
      page={page}
      pageSize={pageSize}
      sortBy={sortBy}
      sortDir={sortDir}
      actions={actions}
    />
  );
}
