"use client";

import TransactionTable from "@/components/transactions/transaction-table";
import type { Transaction } from "@/server/data/types";
import { formatDate } from "@/lib/date";

type Props = {
  day: string;
  transactions: Transaction[];
  total: number;
};

export default function DayTransactions({ day, transactions, total }: Props) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">
        Transactions — {formatDate(day)}
      </h3>
      <TransactionTable
        transactions={transactions}
        total={total}
        page={1}
        pageSize={100}
      />
    </div>
  );
}
