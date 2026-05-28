"use client";

import { useState, useCallback } from "react";
import { formatCurrency } from "@/lib/currency";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type SampleRow = {
  description_raw: string;
  transaction_date: string;
  amount: number;
  institution: string;
};

type ImpactData = {
  count: number;
  sample: SampleRow[];
};

type Props = {
  endpoint: string;
  impactEndpoint?: string;
  params: Record<string, string>;
  impactParams?: Record<string, string>;
  title: string;
  onDeleted: () => void;
  trigger: React.ReactElement;
};

export function ConfirmDeleteDialog({
  endpoint,
  impactEndpoint,
  params,
  impactParams,
  title,
  onDeleted,
  trigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<ImpactData | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchImpact = useCallback(async () => {
    if (!impactEndpoint) return;
    setLoadingImpact(true);
    try {
      const url = new URL(impactEndpoint, window.location.origin);
      const resolvedImpactParams = impactParams ?? params;
      for (const [k, v] of Object.entries(resolvedImpactParams)) url.searchParams.set(k, v);
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = (await res.json()) as ImpactData;
        setImpact(data);
      }
    } finally {
      setLoadingImpact(false);
    }
  }, [impactEndpoint, params, impactParams]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setImpact(null);
      setError(null);
      void fetchImpact();
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const url = new URL(endpoint, window.location.origin);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const res = await fetch(url.toString(), { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Error ${res.status}`);
        return;
      }
      setOpen(false);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {impactEndpoint && (
          <div className="space-y-3">
            {loadingImpact && (
              <p className="text-sm text-muted-foreground">Loading impact...</p>
            )}
            {!loadingImpact && impact && (
              <>
                <p className="text-sm">
                  <span className="font-medium">{impact.count}</span>{" "}
                  {impact.count === 1 ? "transaction is" : "transactions are"} labeled by this rule.
                  {impact.count === 0 && " Deleting it is safe."}
                </p>
                {impact.sample.length > 0 && (
                  <div className="rounded-md border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Description</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {impact.sample.map((row, i) => (
                          <tr key={i} className="hover:bg-muted/20">
                            <td className="px-3 py-2 max-w-[200px] truncate font-mono">{row.description_raw}</td>
                            <td className="px-3 py-2 text-muted-foreground">{row.transaction_date}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {impact.count > impact.sample.length && (
                      <p className="px-3 py-2 text-xs text-muted-foreground bg-muted/20 border-t">
                        …and {impact.count - impact.sample.length} more
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={deleting || loadingImpact}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
