"use client";

import { useState, useCallback, useTransition } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { format, parse } from "date-fns";
import { Search, CalendarIcon, DollarSign, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { getActiveFilterCount, parseFilters } from "@/lib/filters";

type FilterBarProps = {
  institutions?: string[];
  categories?: string[];
};

export default function FilterBar({
  institutions = [],
  categories = [],
}: FilterBarProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  const filters = parseFilters(searchParams);
  const activeCount = getActiveFilterCount(filters);

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value != null && value !== "") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page");
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [searchParams, router, pathname, startTransition]
  );

  const clearAll = useCallback(() => {
    startTransition(() => {
      router.push(pathname);
    });
  }, [router, pathname, startTransition]);

  const startDate = filters.startDate
    ? parse(filters.startDate, "yyyy-MM-dd", new Date())
    : undefined;
  const endDate = filters.endDate
    ? parse(filters.endDate, "yyyy-MM-dd", new Date())
    : undefined;

  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search — full width on mobile, constrained on desktop */}
      <div className="relative w-full lg:max-w-xs lg:flex-1">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search..."
          defaultValue={filters.search ?? ""}
          className="pl-8 h-9 text-sm"
          onKeyDown={(e) => { if (e.key === "Enter") updateParam("search", e.currentTarget.value); }}
          onBlur={(e) => { if (e.target.value !== (filters.search ?? "")) updateParam("search", e.target.value); }}
        />
      </div>

      {/* Date pickers */}
      <Popover open={startOpen} onOpenChange={setStartOpen}>
        <PopoverTrigger className="inline-flex flex-1 lg:flex-none items-center gap-1.5 h-9 px-3 text-sm font-normal rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground justify-start">
          <CalendarIcon className="size-3.5 text-muted-foreground" />
          {startDate ? format(startDate, "MMM d, yyyy") : <span className="text-muted-foreground">From</span>}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={startDate} onSelect={(date) => { updateParam("startDate", date ? format(date, "yyyy-MM-dd") : ""); setStartOpen(false); }} defaultMonth={startDate} />
        </PopoverContent>
      </Popover>

      <Popover open={endOpen} onOpenChange={setEndOpen}>
        <PopoverTrigger className="inline-flex flex-1 lg:flex-none items-center gap-1.5 h-9 px-3 text-sm font-normal rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground justify-start">
          <CalendarIcon className="size-3.5 text-muted-foreground" />
          {endDate ? format(endDate, "MMM d, yyyy") : <span className="text-muted-foreground">To</span>}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={endDate} onSelect={(date) => { updateParam("endDate", date ? format(date, "yyyy-MM-dd") : ""); setEndOpen(false); }} defaultMonth={endDate} />
        </PopoverContent>
      </Popover>

      {/* Selects */}
      <Select value={filters.institutions?.[0] ?? ""} onValueChange={(v) => updateParam("institutions", v)}>
        <SelectTrigger className="h-9 flex-1 lg:flex-none lg:w-auto text-sm"><SelectValue placeholder="Institution" /></SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value="">All institutions</SelectItem>
          {institutions.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={filters.categories?.[0] ?? ""} onValueChange={(v) => updateParam("categories", v)}>
        <SelectTrigger className="h-9 flex-1 lg:flex-none lg:w-auto text-sm"><SelectValue placeholder="Category" /></SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value="">All categories</SelectItem>
          {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={filters.direction ?? ""} onValueChange={(v) => updateParam("direction", v)}>
        <SelectTrigger className="h-9 flex-1 lg:flex-none lg:w-auto text-sm"><SelectValue placeholder="Direction" /></SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value="">All</SelectItem>
          <SelectItem value="debit">Expenses</SelectItem>
          <SelectItem value="credit">Income</SelectItem>
        </SelectContent>
      </Select>

      {/* Min/Max amount — new row on mobile, inline on desktop */}
      <div className="flex w-full lg:w-auto items-center gap-1.5">
        <DollarSign className="hidden lg:block size-3.5 text-muted-foreground shrink-0" />
        <div className="relative flex-1 lg:w-24 lg:flex-none">
          <Input
            type="number"
            placeholder="Min"
            defaultValue={filters.minAmount != null ? String(filters.minAmount) : ""}
            className="h-9 text-sm tabular-nums"
            onKeyDown={(e) => { if (e.key === "Enter") updateParam("minAmount", e.currentTarget.value); }}
            onBlur={(e) => {
              const val = e.target.value;
              const cur = filters.minAmount != null ? String(filters.minAmount) : "";
              if (val !== cur) updateParam("minAmount", val);
            }}
          />
        </div>
        <span className="text-xs text-muted-foreground">–</span>
        <div className="relative flex-1 lg:w-24 lg:flex-none">
          <Input
            type="number"
            placeholder="Max"
            defaultValue={filters.maxAmount != null ? String(filters.maxAmount) : ""}
            className="h-9 text-sm tabular-nums"
            onKeyDown={(e) => { if (e.key === "Enter") updateParam("maxAmount", e.currentTarget.value); }}
            onBlur={(e) => {
              const val = e.target.value;
              const cur = filters.maxAmount != null ? String(filters.maxAmount) : "";
              if (val !== cur) updateParam("maxAmount", val);
            }}
          />
        </div>
      </div>

      {activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={clearAll} className="h-9 gap-1 text-xs text-muted-foreground shrink-0">
          <X className="size-3" /> Clear
        </Button>
      )}
    </div>
  );
}
