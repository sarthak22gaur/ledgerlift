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
};

export default function UnresolvedTable({ transactions, total, page, pageSize }: Props) {
  function actions(txn: Transaction) {
    return (
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
          <Button size="sm" variant="outline">
            Create rule
          </Button>
        }
      />
    );
  }

  return (
    <TransactionTable
      transactions={transactions}
      total={total}
      page={page}
      pageSize={pageSize}
      actions={actions}
    />
  );
}
