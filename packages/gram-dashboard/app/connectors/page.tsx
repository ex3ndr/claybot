"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cable, RefreshCw } from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchEngineStatus, type EngineStatus } from "@/lib/engine-client";

export default function ConnectorsPage() {
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
      setError(err instanceof Error ? err.message : "Failed to load connectors");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connectors = status?.connectors ?? [];
  const lastLoaded = useMemo(() => {
    if (!connectors.length) {
      return "No connectors yet";
    }
    const latest = connectors
      .map((connector) => new Date(connector.loadedAt))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return latest ? latest.toLocaleTimeString() : "Unknown";
  }, [connectors]);

  const connectorNames = useMemo(
    () => connectors.map((connector) => connector.name ?? connector.id),
    [connectors]
  );

  return (
    <DashboardShell
      title="Connectors"
      subtitle="Endpoints connected to the engine runtime."
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
            <span>{connectors.length} connectors online</span>
          )}
        </>
      }
    >
      <div className="flex flex-1 flex-col gap-6 px-4 py-6 lg:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="bg-gradient-to-br from-primary/10 via-card to-card/80">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardDescription>Connector count</CardDescription>
                <CardTitle className="text-2xl">{connectors.length}</CardTitle>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Cable className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {connectorNames.slice(0, 2).join(", ") || "Live connector endpoints feeding the engine."}
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-accent/10 via-card to-card/80">
            <CardHeader>
              <CardDescription>Latest load</CardDescription>
              <CardTitle className="text-xl">{lastLoaded}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Most recent connector initialization.</CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-secondary/30 via-card to-card/80">
            <CardHeader>
              <CardDescription>Health</CardDescription>
              <CardTitle className="text-xl">{connectors.length ? "Healthy" : "Standby"}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Connector pool status.</CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Active connectors</CardTitle>
            <CardDescription>Loaded connector ids and timestamps.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {connectors.length ? (
              connectors.map((connector) => (
                <div
                  key={connector.id}
                  className="rounded-lg border bg-background/60 px-4 py-3 transition duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-background"
                >
                  <div className="text-sm font-medium text-foreground">
                    {connector.name ?? connector.id}
                  </div>
                  {connector.name && connector.name !== connector.id ? (
                    <div className="text-xs text-muted-foreground">Instance: {connector.id}</div>
                  ) : null}
                  {connector.pluginId ? (
                    <div className="mt-1 text-xs text-muted-foreground">Plugin: {connector.pluginId}</div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">
                    Loaded at {new Date(connector.loadedAt).toLocaleTimeString()}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No connectors online.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}
