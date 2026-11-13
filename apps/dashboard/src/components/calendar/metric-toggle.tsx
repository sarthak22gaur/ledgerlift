"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MetricToggleProps = {
  metric: "expenses" | "net";
};

export default function MetricToggle({ metric }: MetricToggleProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function navigate(value: "expenses" | "net") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("metric", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border p-0.5">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("expenses")}
        className={cn(
          "rounded-md",
          metric === "expenses" && "bg-muted text-foreground"
        )}
      >
        Expenses
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("net")}
        className={cn(
          "rounded-md",
          metric === "net" && "bg-muted text-foreground"
        )}
      >
        Net
      </Button>
    </div>
  );
}
