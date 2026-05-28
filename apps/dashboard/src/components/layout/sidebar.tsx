"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  LayoutDashboard,
  ArrowLeftRight,
  Tags,
  Store,
  Building2,
  CircleAlert,
  ArrowRightLeft,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

const mainNav: NavItem[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Transactions", href: "/transactions", icon: ArrowLeftRight },
  { label: "Categories", href: "/categories", icon: Tags },
  { label: "Merchants", href: "/merchants", icon: Store },
  { label: "Accounts", href: "/accounts", icon: Building2 },
  { label: "Rules", href: "/rules", icon: SlidersHorizontal },
];

const reviewNav: NavItem[] = [
  { label: "Unresolved", href: "/review/unresolved", icon: CircleAlert },
  { label: "Transfers", href: "/review/transfers", icon: ArrowRightLeft },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
    >
      <Icon className="size-4 shrink-0" />
      {item.label}
    </Link>
  );
}

export default function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <aside
      className={cn(
        "flex h-full w-60 flex-col border-r bg-background",
        className
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <BarChart3 className="size-5 text-primary" />
        <span className="text-base font-semibold tracking-tight">
          LedgerLift
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3">
        {mainNav.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} />
        ))}

        <Separator className="my-3" />

        <span className="mb-1 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Review
        </span>
        {reviewNav.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </nav>
    </aside>
  );
}
