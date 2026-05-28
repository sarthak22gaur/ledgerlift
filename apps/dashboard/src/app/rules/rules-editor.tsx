"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/rules/copy-button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreateRuleDialog } from "@/components/rules/create-rule-dialog";
import { ConfirmDeleteDialog } from "@/components/rules/confirm-delete-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  CategoryRuleEntry,
  OverrideEntry,
  AccountMappingEntry,
} from "@/lib/schemas";
import type { MerchantRuleWithSource, CategoryRuleWithSource } from "@/server/rules/repository";

type Props = {
  merchantRules: MerchantRuleWithSource[];
  categoryRules: CategoryRuleWithSource[];
  merchantOverrides: OverrideEntry[];
  categoryOverrides: OverrideEntry[];
  accounts: AccountMappingEntry[];
  counterparties: string[];
};


function SourceBadge({ source }: { source: "base" | "user" }) {
  return source === "base" ? (
    <Badge variant="secondary" className="text-xs font-normal">base</Badge>
  ) : (
    <Badge variant="default" className="text-xs font-normal">user</Badge>
  );
}

function whenSummary(rule: CategoryRuleEntry): string {
  const parts: string[] = [];
  if (rule.when.merchant_normalized?.length) {
    parts.push(`merchant in [${rule.when.merchant_normalized.slice(0, 2).join(", ")}${rule.when.merchant_normalized.length > 2 ? "…" : ""}]`);
  }
  if (rule.when.description_regex) {
    parts.push(`regex: ${rule.when.description_regex.slice(0, 30)}${rule.when.description_regex.length > 30 ? "…" : ""}`);
  }
  if (rule.when.direction) parts.push(rule.when.direction);
  if (rule.when.institution) parts.push(`inst: ${rule.when.institution}`);
  return parts.join(", ") || "—";
}

function groupByLabel<T extends { id: string; priority: number; rule_id: number }>(
  rules: T[]
): Array<{ rule: T; isContinuation: boolean; isLastInGroup: boolean }> {
  const sorted = [...rules].sort((a, b) => {
    if (a.id !== b.id) return a.id.localeCompare(b.id);
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.rule_id - b.rule_id;
  });
  return sorted.map((rule, i) => ({
    rule,
    isContinuation: i > 0 && sorted[i - 1].id === rule.id,
    isLastInGroup: i === sorted.length - 1 || sorted[i + 1].id !== rule.id,
  }));
}

function MerchantsTab({ rules }: { rules: MerchantRuleWithSource[] }) {
  const router = useRouter();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rules.length} rules</p>
        <CreateRuleDialog
          mode={{ kind: "merchant-rule" }}
          trigger={
            <Button><Plus className="h-4 w-4 mr-1" />New rule</Button>
          }
        />
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-[60px] font-semibold">Pri</TableHead>
              <TableHead className="w-[90px] font-semibold">Type</TableHead>
              <TableHead className="font-semibold">Pattern</TableHead>
              <TableHead className="font-semibold">Merchant</TableHead>
              <TableHead className="font-semibold">Category</TableHead>
              <TableHead className="w-[80px] font-semibold">Source</TableHead>
              <TableHead className="font-semibold">ID</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  No merchant rules yet. Click &ldquo;New rule&rdquo; to add one.
                </TableCell>
              </TableRow>
            )}
            {groupByLabel(rules).map(({ rule, isContinuation, isLastInGroup }) => (
              <TableRow
                key={rule.rule_id}
                className={cn(
                  "hover:bg-muted/30",
                  isContinuation && "border-t-0 border-l-2 border-l-muted",
                  !isLastInGroup && "border-b-0",
                )}
              >
                <TableCell className="py-2.5 font-mono text-xs">{rule.priority}</TableCell>
                <TableCell className="py-2.5 text-xs">{rule.match.type}</TableCell>
                <TableCell className="py-2.5 max-w-[180px] truncate font-mono text-xs">
                  {rule.match.pattern}
                </TableCell>
                <TableCell className="py-2.5 font-medium text-sm">{rule.canonical_merchant}</TableCell>
                <TableCell className="py-2.5 text-sm text-muted-foreground">
                  {rule.category ?? "—"}
                  {rule.subcategory ? ` / ${rule.subcategory}` : ""}
                </TableCell>
                <TableCell className="py-2.5">
                  <SourceBadge source={rule.source} />
                </TableCell>
                <TableCell className="py-2.5 max-w-[60px] truncate font-mono text-xs text-muted-foreground">
                  {isContinuation ? (
                    <span className="opacity-30">↳</span>
                  ) : (
                    rule.id
                  )}
                </TableCell>
                <TableCell className="py-2.5">
                  <div className="flex items-center gap-1">
                    <CreateRuleDialog
                      mode={{ kind: "merchant-rule", initial: rule }}
                      trigger={
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="sr-only">Edit</span>
                        </Button>
                      }
                    />
                    {rule.source === "base" ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger
                            render={(props) => (
                              <span
                                {...props}
                                aria-disabled="true"
                                className="inline-flex h-7 w-7 cursor-not-allowed items-center justify-center text-muted-foreground/40 select-none"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </span>
                            )}
                          />
                          <TooltipContent>Override base rule instead</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <ConfirmDeleteDialog
                        endpoint="/api/rules/merchants"
                        impactEndpoint="/api/rules/merchants/impact"
                        params={{ rule_id: String(rule.rule_id) }}
                        impactParams={{ rule_label: rule.id }}
                        title={`Delete merchant rule "${rule.id}"?`}
                        onDeleted={() => router.refresh()}
                        trigger={
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        }
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CategoriesTab({ rules }: { rules: CategoryRuleWithSource[] }) {
  const router = useRouter();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rules.length} rules</p>
        <CreateRuleDialog
          mode={{ kind: "category-rule" }}
          trigger={
            <Button><Plus className="h-4 w-4 mr-1" />New rule</Button>
          }
        />
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-[60px] font-semibold">Pri</TableHead>
              <TableHead className="font-semibold">When</TableHead>
              <TableHead className="font-semibold">Category</TableHead>
              <TableHead className="w-[110px] font-semibold">Confidence</TableHead>
              <TableHead className="w-[80px] font-semibold">Source</TableHead>
              <TableHead className="font-semibold">ID</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  No category rules yet. Click &ldquo;New rule&rdquo; to add one.
                </TableCell>
              </TableRow>
            )}
            {groupByLabel(rules).map(({ rule, isContinuation, isLastInGroup }) => (
              <TableRow
                key={rule.rule_id}
                className={cn(
                  "hover:bg-muted/30",
                  isContinuation && "border-t-0 border-l-2 border-l-muted",
                  !isLastInGroup && "border-b-0",
                )}
              >
                <TableCell className="py-2.5 font-mono text-xs">{rule.priority}</TableCell>
                <TableCell className="py-2.5 max-w-[240px] truncate text-xs text-muted-foreground">
                  {whenSummary(rule)}
                </TableCell>
                <TableCell className="py-2.5 font-medium text-sm">
                  {rule.assign.category}
                  {rule.assign.subcategory ? ` / ${rule.assign.subcategory}` : ""}
                </TableCell>
                <TableCell className="py-2.5 text-xs text-muted-foreground">
                  {rule.assign.confidence ?? "—"}
                </TableCell>
                <TableCell className="py-2.5">
                  <SourceBadge source={rule.source} />
                </TableCell>
                <TableCell className="py-2.5 max-w-[60px] truncate font-mono text-xs text-muted-foreground">
                  {isContinuation ? (
                    <span className="opacity-30">↳</span>
                  ) : (
                    rule.id
                  )}
                </TableCell>
                <TableCell className="py-2.5">
                  <div className="flex items-center gap-1">
                    <CreateRuleDialog
                      mode={{ kind: "category-rule", initial: rule }}
                      trigger={
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="sr-only">Edit</span>
                        </Button>
                      }
                    />
                    {rule.source === "base" ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger
                            render={(props) => (
                              <span
                                {...props}
                                aria-disabled="true"
                                className="inline-flex h-7 w-7 cursor-not-allowed items-center justify-center text-muted-foreground/40 select-none"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </span>
                            )}
                          />
                          <TooltipContent>Override base rule instead</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <ConfirmDeleteDialog
                        endpoint="/api/rules/categories"
                        impactEndpoint="/api/rules/categories/impact"
                        params={{ rule_id: String(rule.rule_id) }}
                        impactParams={{ rule_label: rule.id }}
                        title={`Delete category rule "${rule.id}"?`}
                        onDeleted={() => router.refresh()}
                        trigger={
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        }
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

type OverridesKind = "merchant" | "category";

function OverridesTab({
  merchantOverrides,
  categoryOverrides,
}: {
  merchantOverrides: OverrideEntry[];
  categoryOverrides: OverrideEntry[];
}) {
  const router = useRouter();
  const [subKind, setSubKind] = useState<OverridesKind>("merchant");

  const overrides = subKind === "merchant" ? merchantOverrides : categoryOverrides;
  const endpoint =
    subKind === "merchant" ? "/api/rules/merchant-overrides" : "/api/rules/category-overrides";
  const impactEndpoint =
    subKind === "merchant"
      ? "/api/rules/merchant-overrides/impact"
      : "/api/rules/category-overrides/impact";
  const dialogKind =
    subKind === "merchant" ? "merchant-override" as const : "category-override" as const;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Select value={subKind} onValueChange={(v) => setSubKind(v as OverridesKind)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="merchant">Merchant overrides</SelectItem>
              <SelectItem value="category">Category overrides</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">{overrides.length} entries</p>
        </div>
        <CreateRuleDialog
          mode={{ kind: dialogKind }}
          trigger={
            <Button><Plus className="h-4 w-4 mr-1" />New override</Button>
          }
        />
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="font-semibold">ID</TableHead>
              <TableHead className="font-semibold">Pattern / Txn ID</TableHead>
              <TableHead className="font-semibold">Merchant</TableHead>
              <TableHead className="font-semibold">Category</TableHead>
              <TableHead className="font-semibold">Subcategory</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {overrides.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No overrides yet. Click &ldquo;New override&rdquo; to add one.
                </TableCell>
              </TableRow>
            )}
            {overrides.map((ov) => (
              <TableRow key={ov.id} className="hover:bg-muted/30">
                <TableCell className="py-2.5 max-w-[60px] truncate font-mono text-xs text-muted-foreground">
                  {ov.id}
                </TableCell>
                <TableCell className="py-2.5 max-w-[200px] truncate font-mono text-xs">
                  {ov.pattern ?? ov.transaction_id ?? "—"}
                </TableCell>
                <TableCell className="py-2.5 text-sm">{ov.merchant ?? "—"}</TableCell>
                <TableCell className="py-2.5 text-sm">{ov.category ?? "—"}</TableCell>
                <TableCell className="py-2.5 text-sm text-muted-foreground">{ov.subcategory ?? "—"}</TableCell>
                <TableCell className="py-2.5">
                  <div className="flex items-center gap-1">
                    <CreateRuleDialog
                      mode={{ kind: dialogKind, initial: ov }}
                      trigger={
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                          <Pencil className="h-3.5 w-3.5" />
                          <span className="sr-only">Edit</span>
                        </Button>
                      }
                    />
                    <ConfirmDeleteDialog
                      endpoint={endpoint}
                      impactEndpoint={impactEndpoint}
                      params={{ id: ov.id }}
                      title={`Delete override "${ov.id}"?`}
                      onDeleted={() => router.refresh()}
                      trigger={
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      }
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AccountsTab({ accounts }: { accounts: AccountMappingEntry[] }) {
  const router = useRouter();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{accounts.length} mappings</p>
        <CreateRuleDialog
          mode={{ kind: "account-mapping" }}
          trigger={
            <Button><Plus className="h-4 w-4 mr-1" />New mapping</Button>
          }
        />
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-[100px] font-semibold">Last 4</TableHead>
              <TableHead className="font-semibold">Institution</TableHead>
              <TableHead className="font-semibold">Account</TableHead>
              <TableHead className="w-[140px] font-semibold">Opened</TableHead>
              <TableHead className="w-[140px] font-semibold">Closed</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No account mappings yet. Click &ldquo;New mapping&rdquo; to add one.
                </TableCell>
              </TableRow>
            )}
            {accounts.map((acc) => {
              const key = `${acc.institution}:${acc.account}:${acc.last4 ?? ""}`;
              const deleteParams: Record<string, string> = {
                institution: acc.institution,
                account: acc.account,
              };
              if (acc.last4) deleteParams.last4 = acc.last4;
              return (
                <TableRow key={key} className="hover:bg-muted/30">
                  <TableCell className="py-2.5 font-mono text-sm">{acc.last4 ?? "—"}</TableCell>
                  <TableCell className="py-2.5 font-medium text-sm">{acc.institution}</TableCell>
                  <TableCell className="py-2.5 text-sm">{acc.account}</TableCell>
                  <TableCell className="py-2.5 text-sm text-muted-foreground">
                    {acc.opened_date ?? "—"}
                  </TableCell>
                  <TableCell className="py-2.5 text-sm text-muted-foreground">
                    {acc.closed_date ?? "—"}
                  </TableCell>
                  <TableCell className="py-2.5">
                    <div className="flex items-center gap-1">
                      <CreateRuleDialog
                        mode={{ kind: "account-mapping", initial: acc }}
                        trigger={
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                            <Pencil className="h-3.5 w-3.5" />
                            <span className="sr-only">Edit</span>
                          </Button>
                        }
                      />
                      <ConfirmDeleteDialog
                        endpoint="/api/rules/accounts"
                        params={deleteParams}
                        title={`Delete account mapping "${acc.institution} / ${acc.account}"?`}
                        onDeleted={() => router.refresh()}
                        trigger={
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        }
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CounterpartiesTab({ counterparties }: { counterparties: string[] }) {
  const router = useRouter();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{counterparties.length} counterparties</p>
        <CreateRuleDialog
          mode={{ kind: "counterparty" }}
          trigger={
            <Button><Plus className="h-4 w-4 mr-1" />New counterparty</Button>
          }
        />
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="font-semibold">Name</TableHead>
              <TableHead className="w-[120px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {counterparties.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="h-24 text-center text-muted-foreground">
                  No internal counterparties yet. Click &ldquo;New counterparty&rdquo; to add one.
                </TableCell>
              </TableRow>
            )}
            {counterparties.map((name) => (
              <TableRow key={name} className="hover:bg-muted/30">
                <TableCell className="py-2.5 font-mono text-sm">{name}</TableCell>
                <TableCell className="py-2.5">
                  <ConfirmDeleteDialog
                    endpoint="/api/rules/counterparties"
                    params={{ name }}
                    title={`Delete counterparty "${name}"?`}
                    onDeleted={() => router.refresh()}
                    trigger={
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="sr-only">Delete</span>
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

const SEED_CMD = "ledgerlift e2e --force";

function NoRulesBanner() {
  return (
    <div className="flex items-center gap-3 bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
      <span>
        No rules seeded yet. Run{" "}
        <code className="rounded bg-amber-100 px-1 font-mono text-xs">{SEED_CMD}</code>{" "}
        to populate the base rule set.
      </span>
      <CopyButton text={SEED_CMD} />
    </div>
  );
}

export default function RulesEditor({
  merchantRules,
  categoryRules,
  merchantOverrides,
  categoryOverrides,
  accounts,
  counterparties,
}: Props) {
  const allEmpty =
    merchantRules.length === 0 &&
    categoryRules.length === 0 &&
    merchantOverrides.length === 0 &&
    categoryOverrides.length === 0 &&
    accounts.length === 0 &&
    counterparties.length === 0;

  return (
    <div className="space-y-4">
      {allEmpty && <NoRulesBanner />}
      <Tabs defaultValue="merchants">
        <div className="overflow-x-auto">
          <TabsList className="min-w-max">
            <TabsTrigger value="merchants">Merchants</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="overrides">Overrides</TabsTrigger>
            <TabsTrigger value="accounts">Account Mappings</TabsTrigger>
            <TabsTrigger value="counterparties">Counterparties</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="merchants" className="mt-4">
          <MerchantsTab rules={merchantRules} />
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          <CategoriesTab rules={categoryRules} />
        </TabsContent>

        <TabsContent value="overrides" className="mt-4">
          <OverridesTab
            merchantOverrides={merchantOverrides}
            categoryOverrides={categoryOverrides}
          />
        </TabsContent>

        <TabsContent value="accounts" className="mt-4">
          <AccountsTab accounts={accounts} />
        </TabsContent>

        <TabsContent value="counterparties" className="mt-4">
          <CounterpartiesTab counterparties={counterparties} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
