"use client";

import { useCallback } from "react";
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
  const toggle = useCallback(() => {
    document.documentElement.classList.toggle("dark");
  }, []);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-6">
      <h1 className="text-lg font-semibold tracking-tight">{pageTitle}</h1>

      <div className="flex items-center gap-2">
        {children}
        {canShare && <ShareButton />}
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle dark mode">
          <Sun className="hidden size-4 dark:block" />
          <Moon className="size-4 dark:hidden" />
        </Button>
      </div>
    </header>
  );
}
