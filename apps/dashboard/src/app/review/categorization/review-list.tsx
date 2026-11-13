"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/date";
import { categoryReviewOverrideId } from "@/lib/categorization-review";
import type { CategorizationReviewRow } from "@/server/data/types";

function money(amount: number, currency: string) {
  return `${currency} ${Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ReviewCard({ transaction: txn, categories, canEdit, onSaved }: {
  transaction: CategorizationReviewRow;
  categories: string[];
  canEdit: boolean;
  onSaved: (id: string) => void;
}) {
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState(txn.category_normalized ?? "");
  const [subcategory, setSubcategory] = useState(txn.subcategory_normalized ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);

  async function save(nextCategory: string, nextSubcategory: string) {
    if (savingRef.current || !canEdit || !nextCategory.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/rules/category-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: categoryReviewOverrideId(txn.transaction_id),
          transaction_id: txn.transaction_id,
          category: nextCategory.trim(),
          ...(nextSubcategory.trim() ? { subcategory: nextSubcategory.trim() } : {}),
        }),
      });
      if (!response.ok) throw new Error("save failed");
      onSaved(txn.transaction_id);
    } catch {
      setError("Could not save this category. Your transaction is still here; try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <article className="rounded-xl border bg-card p-4 sm:p-5" aria-label={`Review ${txn.merchant_normalized || "transaction"} on ${txn.transaction_date}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-xs text-muted-foreground">{formatDate(txn.transaction_date)} · {txn.account_name}</p>
          <h3 className="mt-1 break-words font-semibold">{txn.merchant_normalized || txn.description_normalized || txn.description_raw}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{txn.institution}</p>
        </div>
        <p className="whitespace-nowrap font-mono text-base font-semibold tabular-nums">
          {txn.direction === "credit" ? "+" : "−"}{money(txn.amount, txn.currency)}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{txn.category_normalized}</Badge>
        {txn.subcategory_normalized && <span className="text-sm text-muted-foreground">/ {txn.subcategory_normalized}</span>}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="min-w-0"><dt className="font-medium">Category source</dt><dd className="mt-0.5 break-words font-mono">{txn.category_rule_id || "Source not recorded"}</dd></div>
        <div><dt className="font-medium">Stored rule-match score</dt><dd className="mt-0.5">{txn.category_confidence == null ? "Not recorded" : txn.category_confidence} · not a probability of error</dd></div>
      </dl>

      <div className="mt-4 rounded-lg bg-muted/50 p-3">
        <p className="text-xs font-medium text-foreground">Why it is worth reviewing</p>
        <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
          {txn.reviewReasons.map((reason, index) => (
            <li key={`${reason.kind}-${index}`}>
              <span className="font-medium text-foreground">{reason.label}</span>
              {reason.kind === "mixed-retailer" && <span> — this retailer sells across categories; its merchant rule assigned this category.</span>}
              {reason.kind === "unusual-amount" && (
                <span> — {reason.ratio.toFixed(1)}× the {reason.baseline} median of {money(reason.median, reason.currency)} across {reason.sampleCount} other imported transactions in the same currency and direction.</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <details className="mt-4 text-sm">
        <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">Description and transaction details</summary>
        <dl className="mt-3 grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <div className="min-w-0 sm:col-span-2"><dt className="text-xs text-muted-foreground">Description</dt><dd className="mt-1 break-words">{txn.description_raw}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Posted date</dt><dd>{formatDate(txn.posted_date)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Type / direction</dt><dd>{txn.transaction_type} / {txn.direction}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Reference</dt><dd>{txn.reference_number || "Not recorded"}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-muted-foreground">Transaction ID</dt><dd className="break-all font-mono text-xs">{txn.transaction_id}</dd></div>
        </dl>
      </details>

      {canEdit && (
        <div className="mt-4 border-t pt-4" aria-busy={saving}>
          {editing ? (
            <form onSubmit={(event) => { event.preventDefault(); void save(category, subcategory); }} className="space-y-3">
              <p className="text-xs text-muted-foreground">Change only this transaction. Leave subcategory blank to clear it.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><label className="text-xs font-medium" htmlFor={`${inputId}-category`}>Category</label><Input id={`${inputId}-category`} list={`${inputId}-categories`} value={category} onChange={(event) => setCategory(event.target.value)} required disabled={saving} /><datalist id={`${inputId}-categories`}>{categories.map((value) => <option key={value} value={value} />)}</datalist></div>
                <div className="space-y-1.5"><label className="text-xs font-medium" htmlFor={`${inputId}-subcategory`}>Subcategory (optional)</label><Input id={`${inputId}-subcategory`} value={subcategory} onChange={(event) => setSubcategory(event.target.value)} disabled={saving} /></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving || !category.trim()}>Save category</Button>
                <Button type="button" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button disabled={saving} onClick={() => void save(txn.category_normalized ?? "", txn.subcategory_normalized ?? "")}><Check className="size-3.5" />Confirm category</Button>
              <Button variant="outline" disabled={saving} onClick={() => setEditing(true)}>Change category</Button>
            </div>
          )}
          <div className="mt-2 flex min-h-5 items-center gap-1.5 text-xs" aria-live="polite">
            {saving && <><LoaderCircle className="size-3 animate-spin" aria-hidden="true" /><span>Saving…</span></>}
            {error && <span role="alert" className="text-destructive">{error}</span>}
          </div>
        </div>
      )}
    </article>
  );
}

export default function CategorizationReviewList({ transactions, total, page, pageSize, categories, canEdit }: {
  transactions: CategorizationReviewRow[];
  total: number;
  page: number;
  pageSize: number;
  categories: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  const [saved, setSaved] = useState(false);
  const visible = transactions.filter((txn) => !savedIds.has(txn.transaction_id));
  const remaining = total - transactions.filter((txn) => savedIds.has(txn.transaction_id)).length;
  const pages = Math.max(1, Math.ceil(remaining / pageSize));
  function pageHref(targetPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(targetPage));
    return `${pathname}?${params.toString()}`;
  }
  function onSaved(id: string) {
    setSavedIds((ids) => new Set(ids).add(id));
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="font-medium">{remaining} transaction{remaining === 1 ? "" : "s"} worth reviewing</p>
        {!canEdit && <Badge variant="outline">Read-only shared view</Badge>}
      </div>
      <p role="status" className="min-h-5 text-xs text-muted-foreground">{saved ? "Category saved. You can continue reviewing; run ledgerlift enrich --force to update derived categories and totals." : ""}</p>
      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <h2 className="font-medium">No transactions to review in this view</h2>
          <p className="mt-2 text-sm text-muted-foreground">No remaining categorized transactions match these review signals and filters. This does not establish that every category is correct.</p>
        </div>
      ) : visible.map((txn) => <ReviewCard key={txn.transaction_id} transaction={txn} categories={categories} canEdit={canEdit} onSaved={onSaved} />)}
      <nav aria-label="Review pagination" className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
        <p className="text-muted-foreground">Page {page} of {Math.max(page, pages)} · up to {pageSize} per page</p>
        <div className="flex gap-2">
          {page > 1 ? <Link href={pageHref(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}><ChevronLeft className="size-4" />Previous</Link> : <Button variant="outline" size="sm" disabled><ChevronLeft className="size-4" />Previous</Button>}
          {page < pages ? <Link href={pageHref(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>Next<ChevronRight className="size-4" /></Link> : <Button variant="outline" size="sm" disabled>Next<ChevronRight className="size-4" /></Button>}
        </div>
      </nav>
    </div>
  );
}
