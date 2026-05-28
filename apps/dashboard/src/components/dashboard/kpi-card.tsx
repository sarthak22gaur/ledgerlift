import type { LucideIcon } from "lucide-react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

type KpiCardProps = {
  title: string;
  value: string;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  icon?: LucideIcon;
};

const trendConfig = {
  up: { Icon: TrendingUp, color: "text-emerald-600 dark:text-emerald-400" },
  down: { Icon: TrendingDown, color: "text-red-600 dark:text-red-400" },
  neutral: { Icon: Minus, color: "text-muted-foreground" },
} as const;

export default function KpiCard({
  title,
  value,
  subtitle,
  trend,
  trendValue,
  icon: IconProp,
}: KpiCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          <div className="flex items-center gap-1.5">
            {trend && trendValue && (
              <>
                {(() => {
                  const { Icon, color } = trendConfig[trend];
                  return (
                    <span className={cn("flex items-center gap-0.5 text-xs font-medium", color)}>
                      <Icon className="size-3" />
                      {trendValue}
                    </span>
                  );
                })()}
              </>
            )}
            {subtitle && (
              <span className="text-xs text-muted-foreground">{subtitle}</span>
            )}
          </div>
        </div>
        {IconProp && (
          <div className="rounded-lg bg-muted p-2">
            <IconProp className="size-5 text-muted-foreground" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
