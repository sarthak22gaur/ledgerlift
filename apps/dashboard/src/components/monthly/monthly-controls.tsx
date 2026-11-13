"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { monthlyUrl, parseMonth, shiftMonth } from "@/lib/monthly";
import type { FilterParams } from "@/server/data/types";

type MonthlyControlsProps = {
  month: string;
  filters: FilterParams;
  institutions: string[];
  accounts: string[];
};

export default function MonthlyControls({ month, filters, institutions, accounts }: MonthlyControlsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function navigate(nextMonth: string, nextFilters = filters) {
    startTransition(() => router.push(monthlyUrl(nextMonth, nextFilters)));
  }

  return (
    <div className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      <div className="space-y-1.5">
        <label htmlFor="monthly-month" className="text-xs font-medium text-muted-foreground">Month</label>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon-lg" aria-label="Previous month" disabled={pending || month === "1000-01"} onClick={() => navigate(shiftMonth(month, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Input id="monthly-month" type="month" min="1000-01" max="9999-12" value={month} disabled={pending} className="h-9 w-44" onChange={(event) => {
            const nextMonth = parseMonth(event.target.value);
            if (nextMonth) navigate(nextMonth);
          }} />
          <Button variant="outline" size="icon-lg" aria-label="Next month" disabled={pending || month === "9999-12"} onClick={() => navigate(shiftMonth(month, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      {([{ key: "institutions", label: "Institutions", options: institutions }, { key: "accounts", label: "Accounts", options: accounts }] as const).map(({ key, label, options }) => {
        const selected = filters[key] ?? [];
        const choices = [...new Set([...options, ...selected])];
        return (
          <div className="space-y-1.5" key={key}>
            <span className="block text-xs font-medium text-muted-foreground">{label}</span>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="lg" disabled={pending} aria-label={`Filter ${label.toLowerCase()}`} />}>
                {selected.length ? `${selected.length} selected` : `All ${label.toLowerCase()}`}
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-56 max-w-80">
                <DropdownMenuItem onClick={() => navigate(month, { ...filters, [key]: undefined })}>All {label.toLowerCase()}</DropdownMenuItem>
                {choices.map((option) => (
                  <DropdownMenuCheckboxItem key={option} checked={selected.includes(option)} onCheckedChange={(checked) => {
                    const next = checked ? [...selected, option] : selected.filter((value) => value !== option);
                    navigate(month, { ...filters, [key]: next.length ? next : undefined });
                  }}>{option}</DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
      <span role="status" className="sr-only">{pending ? "Updating…" : ""}</span>
    </div>
  );
}
