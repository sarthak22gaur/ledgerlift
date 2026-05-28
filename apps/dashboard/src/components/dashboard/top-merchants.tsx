import type { MerchantSummary } from "@/server/data/types";
import { formatCurrency } from "@/lib/currency";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";

type TopMerchantsProps = {
  merchants: MerchantSummary[];
};

export default function TopMerchants({ merchants }: TopMerchantsProps) {
  const maxAmount = merchants.length > 0 ? merchants[0].amount : 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Merchants</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {merchants.map((m) => {
            const pct = maxAmount > 0 ? (m.amount / maxAmount) * 100 : 0;
            return (
              <div key={m.merchant} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium truncate">{m.merchant}</span>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="text-xs text-muted-foreground">
                      {m.count} txn{m.count !== 1 ? "s" : ""}
                    </span>
                    <span className="font-mono text-sm tabular-nums">
                      {formatCurrency(m.amount)}
                    </span>
                  </div>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}

          {merchants.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No merchant data available.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
