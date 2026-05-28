"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
} from "@/components/ui/sheet";
import Sidebar from "@/components/layout/sidebar";
import Header from "@/components/layout/header";

type AppShellProps = {
  pageTitle: string;
  canShare?: boolean;
  children: React.ReactNode;
};

export default function AppShell({ pageTitle, canShare, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar (sheet) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header pageTitle={pageTitle} canShare={canShare}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open navigation"
                />
              }
            >
              <Menu className="size-4" />
            </SheetTrigger>
          </Header>

          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>

        <SheetContent side="left" className="w-60 p-0">
          <Sidebar className="border-r-0" />
        </SheetContent>
      </Sheet>
    </div>
  );
}
