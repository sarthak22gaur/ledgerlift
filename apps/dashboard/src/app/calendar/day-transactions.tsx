"use client";

import TransactionTable from "@/components/transactions/transaction-table";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { Transaction } from "@/server/data/types";
import { formatDate } from "@/lib/date";

type Props = {
  day: string;
  transactions: Transaction[];
  total: number;
};

export default function DayTransactions({ day, transactions, total }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transactions — {formatDate(day)}</CardTitle>
      </CardHeader>
      <CardContent>
        <TransactionTable
          transactions={transactions}
          total={total}
          page={1}
          pageSize={100}
        />
      </CardContent>
    </Card>
  );
}
