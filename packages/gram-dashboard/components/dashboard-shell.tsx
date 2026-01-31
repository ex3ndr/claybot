"use client";

import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type DashboardShellProps = {
  title: string;
  subtitle?: string;
  toolbar?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
};

export function DashboardShell({ title, subtitle, toolbar, status, children }: DashboardShellProps) {
  return (
    <SidebarProvider>
      <AppSidebar variant="inset" />
      <SidebarInset>
        <div className="relative overflow-hidden border-b bg-background/80 backdrop-blur">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)_/_0.18),transparent_45%),radial-gradient(circle_at_20%_120%,hsl(var(--accent)_/_0.12),transparent_55%)]" />
          <header className="relative flex min-h-16 items-center gap-2 px-4 py-2 lg:px-6">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mx-1 h-4" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-lg font-semibold text-foreground sm:text-xl">{title}</h1>
              {subtitle ? (
                <p className="truncate text-xs text-muted-foreground sm:text-sm">{subtitle}</p>
              ) : null}
            </div>
            {toolbar ? <div className="ml-auto flex items-center gap-2">{toolbar}</div> : null}
          </header>
          {status ? (
            <div className="relative px-4 pb-3 lg:px-6">
              <div
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/70 px-3 py-2 text-xs text-muted-foreground shadow-sm",
                  "animate-in fade-in-0 slide-in-from-top-2"
                )}
              >
                {status}
              </div>
            </div>
          ) : null}
        </div>
        <main className="flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
