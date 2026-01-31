"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Image as ImageIcon, RefreshCw } from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchEngineStatus, type EngineStatus } from "@/lib/engine-client";

export default function ProvidersPage() {
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
      setError(err instanceof Error ? err.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const inferenceProviders = status?.inferenceProviders ?? [];
  const imageProviders = status?.imageProviders ?? [];
  const inferenceNames = useMemo(
    () => inferenceProviders.map((provider) => provider.name ?? provider.id),
    [inferenceProviders]
  );

  return (
    <DashboardShell
      title="Providers"
      subtitle="LLM and image generation providers available to the engine."
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
            <span>{inferenceProviders.length + imageProviders.length} providers available</span>
          )}
        </>
      }
    >
      <div className="flex flex-1 flex-col gap-6 px-4 py-6 lg:px-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="bg-gradient-to-br from-primary/10 via-card to-card/80">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardDescription>Inference providers</CardDescription>
                <CardTitle className="text-2xl">{inferenceProviders.length}</CardTitle>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {inferenceNames.slice(0, 2).join(", ") || "No inference providers"}
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-secondary/30 via-card to-card/80">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardDescription>Image providers</CardDescription>
                <CardTitle className="text-2xl">{imageProviders.length}</CardTitle>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <ImageIcon className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {imageProviders.map((provider) => provider.name ?? provider.id).slice(0, 2).join(", ") || "No image providers"}
            </CardContent>
          </Card>
        </div>

        <Card className="bg-background/70">
          <CardHeader>
            <CardTitle>Provider mix</CardTitle>
            <CardDescription>Active inference and image services.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {inferenceProviders.length || imageProviders.length ? (
              <>
                {inferenceProviders.map((provider) => (
                  <Badge key={`inference-${provider.id}`} variant="secondary" className="text-xs">
                    {provider.name ?? provider.id}
                  </Badge>
                ))}
                {imageProviders.map((provider) => (
                  <Badge key={`image-${provider.id}`} variant="outline" className="text-xs">
                    {provider.name ?? provider.id}
                  </Badge>
                ))}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No providers detected.</div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <ProviderList
            title="Inference"
            description="LLM providers currently available."
            items={inferenceProviders.map((provider) => ({
              title: provider.name ?? provider.id,
              meta: provider.label ?? provider.id
            }))}
          />
          <ProviderList
            title="Image Generation"
            description="Image models and services."
            items={imageProviders.map((provider) => ({
              title: provider.name ?? provider.id,
              meta: provider.label ?? provider.id
            }))}
          />
        </div>
      </div>
    </DashboardShell>
  );
}

function ProviderList({
  title,
  description,
  items
}: {
  title: string;
  description: string;
  items: { title: string; meta: string }[];
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length ? (
          items.map((item) => (
            <div
              key={item.title}
              className="rounded-lg border bg-background/60 px-4 py-3 transition duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-background"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">{item.title}</div>
                  <div className="text-xs text-muted-foreground">{item.meta}</div>
                </div>
                <Badge variant="outline">ready</Badge>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
            No providers detected.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
