"use client";

import { useCallback, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import ShareButton from "@/components/layout/share-button";

type HeaderProps = {
  pageTitle: string;
  /** Whether the current user can generate share links (full auth only). */
  canShare?: boolean;
  /** Optional slot rendered to the left of the dark-mode toggle. */
  children?: React.ReactNode;
};

export default function Header({ pageTitle, canShare, children }: HeaderProps) {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  }, [dark]);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-6">
      <h1 className="text-lg font-semibold tracking-tight">{pageTitle}</h1>

      <div className="flex items-center gap-2">
        {children}
        {canShare && <ShareButton />}
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle dark mode">
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </div>
    </header>
  );
}
