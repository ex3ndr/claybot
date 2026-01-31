"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Wrench } from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchEngineStatus, type EngineStatus } from "@/lib/engine-client";

export default function ToolsPage() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEngineStatus();
      setStatus(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tools");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tools = status?.tools ?? [];
  const groupedTools = useMemo(() => {
    const grouped = new Map<string, string[]>();
    tools.forEach((tool) => {
      const bucket = tool.split(".")[0] ?? "core";
      const list = grouped.get(bucket) ?? [];
      list.push(tool);
      grouped.set(bucket, list);
    });
    return Array.from(grouped.entries()).map(([namespace, items]) => ({
      namespace,
      items: items.sort()
    }));
  }, [tools]);
  const topNamespaces = useMemo(() => groupedTools.slice(0, 5), [groupedTools]);

  return (
    <DashboardShell
      title="Tools"
      subtitle="Runtime tool inventory registered with the engine."
      toolbar={
        <Button onClick={() => void refresh()} disabled={loading} className="gap-2">
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      }
      status={
        <>
          <span>{lastUpdated ? `Last synced ${lastUpdated.toLocaleTimeString()}` : "Awaiting first sync"}</span>
          {error ? (
            <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-destructive">
              {error}
            </span>
          ) : (
            <span>{tools.length} tools available</span>
          )}
        </>
      }
    >
      <div className="flex flex-1 flex-col gap-6 px-4 py-6 lg:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="bg-gradient-to-br from-primary/10 via-card to-card/80">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardDescription>Total tools</CardDescription>
                <CardTitle className="text-2xl">{tools.length}</CardTitle>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Wrench className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Utility modules ready for task execution.</CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-accent/10 via-card to-card/80">
            <CardHeader>
              <CardDescription>Categories</CardDescription>
              <CardTitle className="text-2xl">{groupedTools.length || 0}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Grouped by namespace prefix.</CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-secondary/30 via-card to-card/80">
            <CardHeader>
              <CardDescription>Coverage</CardDescription>
              <CardTitle className="text-xl">{tools.length ? "Loaded" : "Empty"}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Tooling availability snapshot.</CardContent>
          </Card>
        </div>

        <Card className="bg-background/70">
          <CardHeader>
            <CardTitle>Top namespaces</CardTitle>
            <CardDescription>Most populated tool groups.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {topNamespaces.length ? (
              topNamespaces.map((group) => (
                <Badge key={group.namespace} variant="secondary" className="gap-2 text-xs">
                  {group.namespace}
                  <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                    {group.items.length}
                  </span>
                </Badge>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">No namespaces available.</div>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Tool registry</CardTitle>
            <CardDescription>Available tool identifiers and namespaces.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            {groupedTools.length ? (
              groupedTools.map((group) => (
                <div key={group.namespace} className="rounded-lg border bg-background/60 px-4 py-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-foreground">{group.namespace}</div>
                    <Badge variant="outline" className="text-xs">
                      {group.items.length} tools
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {group.items.map((tool) => (
                      <Badge key={tool} variant="secondary" className="text-xs">
                        {tool}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No tools registered.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
