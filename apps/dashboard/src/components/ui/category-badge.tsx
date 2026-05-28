import { getCategoryColor } from "@/lib/category-colors";
import { cn } from "@/lib/utils";

type CategoryBadgeProps = {
  category: string | null | undefined;
  className?: string;
};

export default function CategoryBadge({ category, className }: CategoryBadgeProps) {
  if (!category || category === "Uncategorized") {
    return (
      <span className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-dashed border-muted-foreground/30 px-2.5 py-0.5 text-xs font-medium text-muted-foreground",
        className,
      )}>
        Uncategorized
      </span>
    );
  }

  const color = getCategoryColor(category);

  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
      color.bg,
      color.text,
      className,
    )}>
      <span className={cn("size-1.5 rounded-full shrink-0", color.dot)} />
      {category}
    </span>
  );
}
