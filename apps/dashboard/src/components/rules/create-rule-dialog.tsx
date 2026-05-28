"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  MerchantRuleEntry,
  CategoryRuleEntry,
  OverrideEntry,
  AccountMappingEntry,
} from "@/lib/schemas";

export type CreateRuleMode =
  | { kind: "merchant-rule"; initial?: Partial<MerchantRuleEntry> }
  | { kind: "category-rule"; initial?: Partial<CategoryRuleEntry> }
  | { kind: "merchant-override"; initial?: Partial<OverrideEntry> }
  | { kind: "category-override"; initial?: Partial<OverrideEntry> }
  | { kind: "account-mapping"; initial?: Partial<AccountMappingEntry> }
  | { kind: "counterparty"; initial?: { name?: string } };

type Props = {
  mode: CreateRuleMode;
  trigger?: React.ReactElement;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-muted-foreground mb-1">
      {children}
    </label>
  );
}

function MerchantRuleForm({
  initial,
  onSubmit,
  error,
  loading,
  onClose,
}: {
  initial?: Partial<MerchantRuleEntry>;
  onSubmit: (data: MerchantRuleEntry) => void;
  error: string | null;
  loading: boolean;
  onClose: () => void;
}) {
  const [canonicalMerchant, setCanonicalMerchant] = useState(
    initial?.canonical_merchant ?? ""
  );
  const [matchType, setMatchType] = useState<"regex" | "contains" | "prefix" | "exact">(
    initial?.match?.type ?? "contains"
  );
  const [matchPattern, setMatchPattern] = useState(initial?.match?.pattern ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [subcategory, setSubcategory] = useState(initial?.subcategory ?? "");
  const [priority, setPriority] = useState(String(initial?.priority ?? 50));
  const [id, setId] = useState(initial?.id ?? "");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const computedId = id.trim() || slugify(canonicalMerchant) || slugify(matchPattern);
    onSubmit({
      id: computedId,
      priority: Number(priority) || 50,
      match: { type: matchType, pattern: matchPattern },
      canonical_merchant: canonicalMerchant,
      ...(category ? { category } : {}),
      ...(subcategory ? { subcategory } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label htmlFor="canonical_merchant">Canonical merchant *</Label>
        <Input
          id="canonical_merchant"
          value={canonicalMerchant}
          onChange={(e) => setCanonicalMerchant(e.target.value)}
          placeholder="e.g. Whole Foods"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="match_type">Match type *</Label>
          <Select value={matchType} onValueChange={(v) => setMatchType(v as typeof matchType)}>
            <SelectTrigger id="match_type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="contains">contains</SelectItem>
              <SelectItem value="exact">exact</SelectItem>
              <SelectItem value="prefix">prefix</SelectItem>
              <SelectItem value="regex">regex</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="priority">Priority</Label>
          <Input
            id="priority"
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            placeholder="50"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="match_pattern">Match pattern *</Label>
        <Input
          id="match_pattern"
          value={matchPattern}
          onChange={(e) => setMatchPattern(e.target.value)}
          placeholder="e.g. WHOLEFDS or WFM"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="category">Category</Label>
          <Input
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Groceries"
          />
        </div>
        <div>
          <Label htmlFor="subcategory">Subcategory</Label>
          <Input
            id="subcategory"
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            placeholder="optional"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="rule_id">Rule ID (auto-generated if blank)</Label>
        <Input
          id="rule_id"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder={slugify(canonicalMerchant) || "auto"}
        />
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving…" : "Save rule"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CategoryRuleForm({
  initial,
  onSubmit,
  error,
  loading,
  onClose,
}: {
  initial?: Partial<CategoryRuleEntry>;
  onSubmit: (data: CategoryRuleEntry) => void;
  error: string | null;
  loading: boolean;
  onClose: () => void;
}) {
  const [id, setId] = useState(initial?.id ?? "");
  const [priority, setPriority] = useState(String(initial?.priority ?? 50));
  const [merchants, setMerchants] = useState(
    (initial?.when?.merchant_normalized ?? []).join(", ")
  );
  const [descRegex, setDescRegex] = useState(initial?.when?.description_regex ?? "");
  const [direction, setDirection] = useState<"debit" | "credit" | "">(
    initial?.when?.direction ?? ""
  );
  const [category, setCategory] = useState(initial?.assign?.category ?? "");
  const [subcategory, setSubcategory] = useState(initial?.assign?.subcategory ?? "");
  const [confidence, setConfidence] = useState(
    String(initial?.assign?.confidence ?? "")
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const merchantList = merchants
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const computedId = id.trim() || slugify(category) || `cat-rule-${Date.now()}`;
    onSubmit({
      id: computedId,
      priority: Number(priority) || 50,
      when: {
        ...(merchantList.length > 0 ? { merchant_normalized: merchantList } : {}),
        ...(descRegex ? { description_regex: descRegex } : {}),
        ...(direction ? { direction } : {}),
      },
      assign: {
        category,
        ...(subcategory ? { subcategory } : {}),
        ...(confidence ? { confidence: Number(confidence) } : {}),
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label htmlFor="cat_category">Assign category *</Label>
        <Input
          id="cat_category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. Dining"
          required
        />
      </div>
      <div>
        <Label htmlFor="cat_subcategory">Assign subcategory</Label>
        <Input
          id="cat_subcategory"
          value={subcategory}
          onChange={(e) => setSubcategory(e.target.value)}
          placeholder="optional"
        />
      </div>
      <div>
        <Label htmlFor="cat_merchants">
          When merchant is (comma-separated)
        </Label>
        <Input
          id="cat_merchants"
          value={merchants}
          onChange={(e) => setMerchants(e.target.value)}
          placeholder="e.g. Whole Foods, Target"
        />
      </div>
      <div>
        <Label htmlFor="cat_desc_regex">When description matches regex</Label>
        <Input
          id="cat_desc_regex"
          value={descRegex}
          onChange={(e) => setDescRegex(e.target.value)}
          placeholder="e.g. PAYROLL|DIRECT DEP"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label htmlFor="cat_direction">Direction</Label>
          <Select value={direction} onValueChange={(v) => setDirection(v as "debit" | "credit" | "")}>
            <SelectTrigger id="cat_direction" className="w-full">
              <SelectValue placeholder="any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">any</SelectItem>
              <SelectItem value="debit">debit</SelectItem>
              <SelectItem value="credit">credit</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="cat_priority">Priority</Label>
          <Input
            id="cat_priority"
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            placeholder="50"
          />
        </div>
        <div>
          <Label htmlFor="cat_confidence">Confidence</Label>
          <Input
            id="cat_confidence"
            type="number"
            min="0"
            max="1"
            step="0.1"
            value={confidence}
            onChange={(e) => setConfidence(e.target.value)}
            placeholder="0.9"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="cat_id">Rule ID (auto-generated if blank)</Label>
        <Input
          id="cat_id"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder={slugify(category) || "auto"}
        />
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving…" : "Save rule"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function OverrideForm({
  initial,
  onSubmit,
  error,
  loading,
  onClose,
}: {
  initial?: Partial<OverrideEntry>;
  onSubmit: (data: OverrideEntry) => void;
  error: string | null;
  loading: boolean;
  onClose: () => void;
}) {
  const [id, setId] = useState(initial?.id ?? "");
  const [pattern, setPattern] = useState(initial?.pattern ?? "");
  const [transactionId, setTransactionId] = useState(initial?.transaction_id ?? "");
  const [merchant, setMerchant] = useState(initial?.merchant ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [subcategory, setSubcategory] = useState(initial?.subcategory ?? "");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const computedId =
      id.trim() ||
      slugify(merchant || category) ||
      `override-${Date.now()}`;
    onSubmit({
      id: computedId,
      ...(pattern ? { pattern } : {}),
      ...(transactionId ? { transaction_id: transactionId } : {}),
      ...(merchant ? { merchant } : {}),
      ...(category ? { category } : {}),
      ...(subcategory ? { subcategory } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Requires at least one of: pattern or transaction ID; and at least one of: merchant, category, subcategory.
      </p>
      <div>
        <Label htmlFor="ov_pattern">Pattern (regex)</Label>
        <Input
          id="ov_pattern"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="e.g. AMAZON.*PRIME"
        />
      </div>
      <div>
        <Label htmlFor="ov_txn_id">Transaction ID (exact match)</Label>
        <Input
          id="ov_txn_id"
          value={transactionId}
          onChange={(e) => setTransactionId(e.target.value)}
          placeholder="txn_abc123…"
        />
      </div>
      <div>
        <Label htmlFor="ov_merchant">Override merchant</Label>
        <Input
          id="ov_merchant"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          placeholder="e.g. Amazon"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="ov_category">Override category</Label>
          <Input
            id="ov_category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Shopping"
          />
        </div>
        <div>
          <Label htmlFor="ov_subcategory">Override subcategory</Label>
          <Input
            id="ov_subcategory"
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            placeholder="optional"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="ov_id">Override ID (auto-generated if blank)</Label>
        <Input
          id="ov_id"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="auto"
        />
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving…" : "Save override"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function AccountMappingForm({
  initial,
  onSubmit,
  error,
  loading,
  onClose,
}: {
  initial?: Partial<AccountMappingEntry>;
  onSubmit: (data: AccountMappingEntry) => void;
  error: string | null;
  loading: boolean;
  onClose: () => void;
}) {
  const [institution, setInstitution] = useState(initial?.institution ?? "");
  const [account, setAccount] = useState(initial?.account ?? "");
  const [last4, setLast4] = useState(initial?.last4 ?? "");
  const [openedDate, setOpenedDate] = useState(initial?.opened_date ?? "");
  const [closedDate, setClosedDate] = useState(initial?.closed_date ?? "");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit({
      institution,
      account,
      ...(last4 ? { last4 } : {}),
      ...(openedDate ? { opened_date: openedDate } : {}),
      ...(closedDate ? { closed_date: closedDate } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label htmlFor="acc_institution">Institution *</Label>
        <Input
          id="acc_institution"
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
          placeholder="e.g. Chase"
          required
        />
      </div>
      <div>
        <Label htmlFor="acc_account">Account name *</Label>
        <Input
          id="acc_account"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder="e.g. Checking"
          required
        />
      </div>
      <div>
        <Label htmlFor="acc_last4">Last 4 digits</Label>
        <Input
          id="acc_last4"
          value={last4}
          onChange={(e) => setLast4(e.target.value)}
          placeholder="e.g. 1234"
          maxLength={4}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="acc_opened">Opened date</Label>
          <Input
            id="acc_opened"
            type="date"
            value={openedDate}
            onChange={(e) => setOpenedDate(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="acc_closed">Closed date</Label>
          <Input
            id="acc_closed"
            type="date"
            value={closedDate}
            onChange={(e) => setClosedDate(e.target.value)}
          />
        </div>
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving…" : "Save account"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CounterpartyForm({
  initial,
  onSubmit,
  error,
  loading,
  onClose,
}: {
  initial?: { name?: string };
  onSubmit: (name: string) => void;
  error: string | null;
  loading: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(name);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label htmlFor="cp_name">Counterparty name *</Label>
        <Input
          id="cp_name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Venmo Transfer"
          required
        />
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving…" : "Save counterparty"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function dialogTitle(mode: CreateRuleMode): string {
  switch (mode.kind) {
    case "merchant-rule":
      return "New merchant rule";
    case "category-rule":
      return "New category rule";
    case "merchant-override":
      return "New merchant override";
    case "category-override":
      return "New category override";
    case "account-mapping":
      return "New account mapping";
    case "counterparty":
      return "New internal counterparty";
  }
}

function apiEndpoint(kind: CreateRuleMode["kind"]): string {
  switch (kind) {
    case "merchant-rule":
      return "/api/rules/merchants";
    case "category-rule":
      return "/api/rules/categories";
    case "merchant-override":
      return "/api/rules/merchant-overrides";
    case "category-override":
      return "/api/rules/category-overrides";
    case "account-mapping":
      return "/api/rules/accounts";
    case "counterparty":
      return "/api/rules/counterparties";
  }
}

export function CreateRuleDialog({ mode, trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setOpen(false);
    setError(null);
  }

  async function submitToApi(body: unknown) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiEndpoint(mode.kind), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Server error ${res.status}`);
        return;
      }
      handleClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const defaultTrigger = (
    <Button variant="outline" size="sm">
      New
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ?? defaultTrigger} />
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{dialogTitle(mode)}</DialogTitle>
        </DialogHeader>

        {mode.kind === "merchant-rule" && (
          <MerchantRuleForm
            initial={mode.initial}
            onSubmit={(data) => submitToApi(data)}
            error={error}
            loading={loading}
            onClose={handleClose}
          />
        )}
        {mode.kind === "category-rule" && (
          <CategoryRuleForm
            initial={mode.initial}
            onSubmit={(data) => submitToApi(data)}
            error={error}
            loading={loading}
            onClose={handleClose}
          />
        )}
        {mode.kind === "merchant-override" && (
          <OverrideForm
            initial={mode.initial}
            onSubmit={(data) => submitToApi(data)}
            error={error}
            loading={loading}
            onClose={handleClose}
          />
        )}
        {mode.kind === "category-override" && (
          <OverrideForm
            initial={mode.initial}
            onSubmit={(data) => submitToApi(data)}
            error={error}
            loading={loading}
            onClose={handleClose}
          />
        )}
        {mode.kind === "account-mapping" && (
          <AccountMappingForm
            initial={mode.initial}
            onSubmit={(data) => submitToApi(data)}
            error={error}
            loading={loading}
            onClose={handleClose}
          />
        )}
        {mode.kind === "counterparty" && (
          <CounterpartyForm
            initial={mode.initial}
            onSubmit={(name) => submitToApi({ name })}
            error={error}
            loading={loading}
            onClose={handleClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
