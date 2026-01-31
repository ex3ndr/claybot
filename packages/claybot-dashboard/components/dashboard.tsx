"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import {
  Activity,
  AlarmClock,
  ArrowUpRight,
  Boxes,
  Cable,
  Cpu,
  MessageSquare,
  Plug,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap
} from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  fetchBackgroundAgents,
  fetchCronTasks,
  fetchEngineStatus,
  fetchHeartbeatTasks,
  fetchSessions,
  type BackgroundAgentState,
  type CronTask,
  type EngineEvent,
  type EngineStatus,
  type HeartbeatTask,
  type Session
} from "@/lib/engine-client";
import type { LucideIcon } from "lucide-react";

type InventoryItem = {
  title: string;
  meta?: string;
};

export default function Dashboard() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [cron, setCron] = useState<CronTask[]>([]);
  const [heartbeats, setHeartbeats] = useState<HeartbeatTask[]>([]);
  const [backgroundAgents, setBackgroundAgents] = useState<BackgroundAgentState[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStatus = useCallback(async () => {
    const nextStatus = await fetchEngineStatus();
    setStatus(nextStatus ?? null);
  }, []);

  const fetchCron = useCallback(async () => {
    const tasks = await fetchCronTasks();
    setCron(tasks);
  }, []);

  const fetchHeartbeats = useCallback(async () => {
    const tasks = await fetchHeartbeatTasks();
    setHeartbeats(tasks);
  }, []);

  const fetchBackgroundAgentsData = useCallback(async () => {
    const agents = await fetchBackgroundAgents();
    setBackgroundAgents(agents);
  }, []);

  const fetchSessionsData = useCallback(async () => {
    const data = await fetchSessions();
    setSessions(data);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchStatus(), fetchCron(), fetchHeartbeats(), fetchBackgroundAgentsData(), fetchSessionsData()]);
      setLastUpdated(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Refresh failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [fetchBackgroundAgentsData, fetchCron, fetchHeartbeats, fetchSessionsData, fetchStatus]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const source = new EventSource("/api/v1/engine/events");

    source.onopen = () => {
      setConnected(true);
    };

    source.onerror = () => {
      setConnected(false);
    };

    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as EngineEvent;
      if (payload.type === "init") {
        setStatus(payload.payload?.status ?? null);
        setCron(payload.payload?.cron ?? []);
        setHeartbeats(payload.payload?.heartbeat ?? []);
        setBackgroundAgents(payload.payload?.backgroundAgents ?? []);
        void fetchSessionsData();
        return;
      }

      switch (payload.type) {
        case "session.created":
        case "session.updated":
          void fetchSessionsData();
          void fetchBackgroundAgentsData();
          break;
        case "cron.task.added":
        case "cron.started":
        case "cron.task.ran":
          void fetchCron();
          break;
        case "heartbeat.started":
        case "heartbeat.task.ran":
          void fetchHeartbeats();
          break;
        case "plugin.loaded":
        case "plugin.unloaded":
          void fetchStatus();
          break;
        default:
          break;
      }
    };

    return () => {
      source.close();
    };
  }, [fetchBackgroundAgentsData, fetchCron, fetchHeartbeats, fetchSessionsData, fetchStatus]);

  const pluginCount = status?.plugins?.length ?? 0;
  const sessionCount = sessions.length;
  const cronCount = cron.length;
  const heartbeatCount = heartbeats.length;
  const backgroundAgentCount = backgroundAgents.length;
  const connectorCount = status?.connectors?.length ?? 0;
  const providerCount = status?.inferenceProviders?.length ?? 0;
  const imageProviderCount = status?.imageProviders?.length ?? 0;
  const toolCount = status?.tools?.length ?? 0;
  const orderedSessions = useMemo(() => sortSessionsByActivity(sessions), [sessions]);

  const connectorTiles = useMemo(
    () =>
      status?.connectors?.map((connector) => ({
        title: connector.name ?? connector.id,
        meta: formatTime(connector.loadedAt)
      })) ?? [],
    [status?.connectors]
  );

  const providerTiles = useMemo(
    () =>
      status?.inferenceProviders?.map((provider) => ({
        title: provider.name ?? provider.id,
        meta: provider.label ?? provider.id
      })) ?? [],
    [status?.inferenceProviders]
  );

  const imageTiles = useMemo(
    () =>
      status?.imageProviders?.map((provider) => ({
        title: provider.name ?? provider.id,
        meta: provider.label ?? provider.id
      })) ?? [],
    [status?.imageProviders]
  );

  const pluginTiles = useMemo(
    () =>
      status?.plugins?.map((plugin) => ({
        title: plugin.name ?? plugin.id,
        meta: plugin.id === plugin.pluginId ? "loaded" : plugin.id
      })) ?? [],
    [status?.plugins]
  );

  const toolTiles = useMemo(
    () => status?.tools?.map((tool) => ({ title: tool, meta: "tool" })) ?? [],
    [status?.tools]
  );

  return (
    <DashboardShell
      title="Engine Overview"
      subtitle="Monitor the ClayBot runtime, providers, and sessions."
      toolbar={
        <>
          <Badge variant={connected ? "default" : "outline"} className={connected ? "bg-emerald-500 text-white" : ""}>
            {connected ? "Live" : "Offline"}
          </Badge>
          <Button onClick={() => void refreshAll()} disabled={loading} className="gap-2">
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {loading ? "Refreshing" : "Refresh"}
          </Button>
        </>
      }
      status={
        <>
          <span>{lastUpdated ? `Last synced ${lastUpdated.toLocaleTimeString()}` : "Awaiting first sync"}</span>
          {error ? (
            <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-destructive">
              {error}
            </span>
          ) : (
            <span>Streaming engine events from local socket</span>
          )}
        </>
      }
    >
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-6 py-6">
          <SectionCards
            stats={[
              {
                title: "Engine plugins",
                value: pluginCount,
                description: "Runtime modules loaded",
                meta: `${toolCount} tools registered`,
                trend: pluginCount > 0 ? "up" : "down",
                icon: Boxes,
                tone: "primary"
              },
              {
                title: "Active sessions",
                value: sessionCount,
                description: "Conversation threads online",
                meta: sessionCount ? "Traffic flowing" : "No active sessions",
                trend: sessionCount > 0 ? "up" : "down",
                icon: MessageSquare,
                tone: "accent"
              },
              {
                title: "Automations",
                value: cronCount + heartbeatCount,
                description: "Scheduled tasks",
                meta: `${cronCount} cron · ${heartbeatCount} heartbeat`,
                trend: cronCount + heartbeatCount > 0 ? "up" : "down",
                icon: AlarmClock,
                tone: "amber"
              },
              {
                title: "Connectors",
                value: connectorCount,
                description: "Live connector endpoints",
                meta: connectorCount ? "Healthy" : "Standby",
                trend: connectorCount > 0 ? "up" : "down",
                icon: Plug,
                tone: "emerald"
              }
            ]}
          />
          <SignalStrip
            items={[
              {
                label: "Event stream",
                value: connected ? "Streaming" : "Offline",
                detail: connected ? "SSE live updates" : "Waiting for engine",
                icon: Activity
              },
              {
                label: "Providers ready",
                value: `${providerCount + imageProviderCount}`,
                detail: providerCount ? "Inference online" : "No inference providers",
                icon: Zap
              },
              {
                label: "Last sync",
                value: lastUpdated ? lastUpdated.toLocaleTimeString() : "Pending",
                detail: lastUpdated ? "Data refreshed" : "Waiting for first sync",
                icon: Cpu
              }
            ]}
          />
          <QuickActions
            actions={[
              {
                label: "Sessions",
                description: "Inspect active conversations",
                href: "/sessions",
                value: `${sessionCount} live`,
                icon: MessageSquare
              },
              {
                label: "Automations",
                description: "Review scheduled workflows",
                href: "/automations",
                value: `${cronCount + heartbeatCount} running`,
                icon: AlarmClock
              },
              {
                label: "Connectors",
                description: "Manage ingress endpoints",
                href: "/connectors",
                value: `${connectorCount} online`,
                icon: Plug
              },
              {
                label: "Providers",
                description: "Model and image providers",
                href: "/providers",
                value: `${providerCount + imageProviderCount} ready`,
                icon: Zap
              }
            ]}
          />
          <div className="grid gap-6 px-4 lg:grid-cols-3 lg:px-6">
            <div className="flex flex-col gap-6 lg:col-span-2">
              <ActivityChart sessionCount={sessionCount} cronCount={cronCount} />
              <SessionsTable sessions={orderedSessions} />
            </div>
            <div className="flex flex-col gap-6">
              <InventoryPanel
                groups={[
                  {
                    id: "plugins",
                    label: `Plugins (${pluginCount})`,
                    items: pluginTiles,
                    empty: "No plugins loaded."
                  },
                  {
                    id: "connectors",
                    label: `Connectors (${connectorCount})`,
                    items: connectorTiles,
                    empty: "No connectors online."
                  },
                  {
                    id: "providers",
                    label: `Inference (${providerCount})`,
                    items: providerTiles,
                    empty: "No inference providers."
                  },
                  {
                    id: "images",
                    label: `Image (${imageProviderCount})`,
                    items: imageTiles,
                    empty: "No image providers."
                  },
                  {
                    id: "tools",
                    label: `Tools (${toolCount})`,
                    items: toolTiles,
                    empty: "No tools registered."
                  }
                ]}
              />
              <CronPanel cron={cron} />
              <HeartbeatPanel heartbeats={heartbeats} />
              <BackgroundAgentsPanel agents={backgroundAgents} />
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

type Stat = {
  title: string;
  value: number;
  description: string;
  meta: string;
  trend: "up" | "down";
  icon: LucideIcon;
  tone: "primary" | "accent" | "amber" | "emerald";
};

function SectionCards({ stats }: { stats: Stat[] }) {
  const toneStyles: Record<Stat["tone"], string> = {
    primary: "from-primary/15 via-card to-card",
    accent: "from-accent/15 via-card to-card",
    amber: "from-amber-400/15 via-card to-card",
    emerald: "from-emerald-400/15 via-card to-card"
  };

  return (
    <div className="grid gap-4 px-4 md:grid-cols-2 xl:grid-cols-4 lg:px-6">
      {stats.map((stat) => (
        <Card
          key={stat.title}
          className="@container/card relative overflow-hidden bg-gradient-to-br from-card to-card/80 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-lg"
        >
          <div className={`absolute inset-0 bg-gradient-to-br ${toneStyles[stat.tone]}`} />
          <CardHeader className="relative">
            <CardDescription>{stat.title}</CardDescription>
            <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
              {stat.value}
            </CardTitle>
            <div className="absolute right-4 top-4 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm">
                <stat.icon className="h-4 w-4" />
              </div>
              <Badge variant="outline" className="flex gap-1 rounded-lg text-xs">
                {stat.trend === "up" ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                {stat.trend === "up" ? "Active" : "Idle"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{stat.description}</span>
            <span>{stat.meta}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SignalStrip({
  items
}: {
  items: { label: string; value: string; detail: string; icon: LucideIcon }[];
}) {
  return (
    <div className="grid gap-4 px-4 md:grid-cols-3 lg:px-6">
      {items.map((item) => (
        <Card key={item.label} className="bg-background/70">
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-foreground">
              <item.icon className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</div>
              <div className="text-lg font-semibold text-foreground">{item.value}</div>
              <div className="text-xs text-muted-foreground">{item.detail}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function QuickActions({
  actions
}: {
  actions: { label: string; description: string; href: string; value: string; icon: LucideIcon }[];
}) {
  return (
    <div className="grid gap-4 px-4 md:grid-cols-2 lg:grid-cols-4 lg:px-6">
      {actions.map((action) => (
        <Link key={action.label} href={action.href} className="group">
          <Card className="relative overflow-hidden transition duration-300 group-hover:-translate-y-0.5 group-hover:shadow-lg">
            <div className="absolute inset-0 bg-gradient-to-br from-muted/30 via-transparent to-transparent" />
            <CardContent className="relative flex items-center justify-between pt-6">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{action.label}</div>
                <div className="text-sm font-semibold text-foreground">{action.description}</div>
                <div className="mt-2 text-xs text-muted-foreground">{action.value}</div>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background text-foreground shadow-sm">
                <action.icon className="h-4 w-4" />
              </div>
            </CardContent>
            <div className="relative flex items-center justify-end px-6 pb-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                Open view
                <ArrowUpRight className="h-3 w-3 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function ActivityChart({ sessionCount, cronCount }: { sessionCount: number; cronCount: number }) {
  const isMobile = useIsMobile();
  const [range, setRange] = useState("24h");

  useEffect(() => {
    if (isMobile) {
      setRange("6h");
    }
  }, [isMobile]);

  const chartData = useMemo(() => buildActivitySeries(range, sessionCount, cronCount), [range, sessionCount, cronCount]);

  const chartConfig = {
    sessions: {
      label: "Sessions",
      color: "hsl(var(--chart-1))"
    },
    cron: {
      label: "Automations",
      color: "hsl(var(--chart-2))"
    }
  } satisfies ChartConfig;

  return (
    <Card className="@container/card animate-in fade-in-0 slide-in-from-bottom-2">
      <CardHeader className="relative">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Cpu className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>Engine activity</CardTitle>
            <CardDescription>Sessions and automation triggers over time.</CardDescription>
          </div>
        </div>
        <div className="absolute right-4 top-4">
          <ToggleGroup
            type="single"
            value={range}
            onValueChange={(value) => value && setRange(value)}
            variant="outline"
            className="@[767px]/card:flex hidden"
          >
            <ToggleGroupItem value="6h" className="h-8 px-2.5">
              Last 6h
            </ToggleGroupItem>
            <ToggleGroupItem value="24h" className="h-8 px-2.5">
              Last 24h
            </ToggleGroupItem>
            <ToggleGroupItem value="7d" className="h-8 px-2.5">
              Last 7d
            </ToggleGroupItem>
          </ToggleGroup>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="@[767px]/card:hidden flex w-36" aria-label="Select time range">
              <SelectValue placeholder="Last 24h" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="6h" className="rounded-lg">
                Last 6 hours
              </SelectItem>
              <SelectItem value="24h" className="rounded-lg">
                Last 24 hours
              </SelectItem>
              <SelectItem value="7d" className="rounded-lg">
                Last 7 days
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full">
          <AreaChart data={chartData} margin={{ left: 8, right: 8 }}>
            <defs>
              <linearGradient id="fillSessions" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-sessions)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="var(--color-sessions)" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="fillCron" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-cron)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="var(--color-cron)" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="timestamp"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={(value) =>
                new Date(value).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit"
                })
              }
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent labelFormatter={(value) => formatShortDate(value)} indicator="dot" />}
            />
            <Area
              dataKey="sessions"
              type="natural"
              fill="url(#fillSessions)"
              stroke="var(--color-sessions)"
              stackId="a"
            />
            <Area
              dataKey="cron"
              type="natural"
              fill="url(#fillCron)"
              stroke="var(--color-cron)"
              stackId="a"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function InventoryPanel({
  groups
}: {
  groups: {
    id: string;
    label: string;
    items: InventoryItem[];
    empty: string;
  }[];
}) {
  return (
    <Card className="flex h-full flex-col animate-in fade-in-0 slide-in-from-bottom-2">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent-foreground">
            <Boxes className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-lg">Inventory</CardTitle>
            <CardDescription>Runtime modules and providers.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <Tabs defaultValue={groups[0]?.id} className="flex flex-col gap-4">
          <TabsList className="flex flex-wrap">
            {groups.map((group) => (
              <TabsTrigger key={group.id} value={group.id} className="text-xs">
                {group.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {groups.map((group) => (
            <TabsContent key={group.id} value={group.id} className="mt-0">
              <InventoryList items={group.items} empty={group.empty} />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function InventoryList({ items, empty }: { items: InventoryItem[]; empty: string }) {
  if (!items.length) {
    return <EmptyState label={empty} />;
  }

  return (
    <div className="max-h-64 space-y-3 overflow-y-auto pr-2">
      {items.map((item) => (
        <div key={`${item.title}-${item.meta}`} className="rounded-lg border bg-background/60 px-4 py-3">
          <div className="text-sm font-medium text-foreground">{item.title}</div>
          <div className="text-xs text-muted-foreground">{item.meta}</div>
        </div>
      ))}
    </div>
  );
}

function CronPanel({ cron }: { cron: CronTask[] }) {
  return (
    <Card className="animate-in fade-in-0 slide-in-from-bottom-2">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <AlarmClock className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-lg">Cron tasks</CardTitle>
            <CardDescription>Scheduled jobs running in the engine.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {cron.length ? (
          cron.map((task, index) => (
            <div
              key={task.id ?? `cron-${index}`}
              className="rounded-lg border bg-background/60 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-foreground">{task.name ?? task.id ?? "task"}</div>
                  <div className="text-xs text-muted-foreground">
                    {task.description ?? task.prompt ?? "custom"}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 text-xs">
                  <Badge variant="outline" className="text-xs">
                    {task.deleteAfterRun ? "once" : "repeat"}
                  </Badge>
                  {task.enabled === false ? (
                    <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                      disabled
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Cable className="h-3 w-3" />
                <span>{task.schedule ?? "custom schedule"}</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Activity className="h-3 w-3" />
                <span>{task.lastRunAt ? `Last run ${formatShortDate(task.lastRunAt)}` : "Never run"}</span>
              </div>
            </div>
          ))
        ) : (
          <EmptyState label="No cron tasks scheduled." />
        )}
      </CardContent>
    </Card>
  );
}

function HeartbeatPanel({ heartbeats }: { heartbeats: HeartbeatTask[] }) {
  return (
    <Card className="animate-in fade-in-0 slide-in-from-bottom-2">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-lg">Heartbeats</CardTitle>
            <CardDescription>Periodic check-ins that keep context fresh.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {heartbeats.length ? (
          heartbeats.map((task) => (
            <div key={task.id} className="rounded-lg border bg-background/60 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-foreground">{task.title}</div>
                  <div className="text-xs text-muted-foreground">{task.id}</div>
                </div>
                <Badge variant="outline" className="text-xs">
                  heartbeat
                </Badge>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Activity className="h-3 w-3" />
                <span>{task.lastRunAt ? `Last run ${formatShortDate(task.lastRunAt)}` : "Never run"}</span>
              </div>
            </div>
          ))
        ) : (
          <EmptyState label="No heartbeat files found." />
        )}
      </CardContent>
    </Card>
  );
}

function BackgroundAgentsPanel({ agents }: { agents: BackgroundAgentState[] }) {
  return (
    <Card className="animate-in fade-in-0 slide-in-from-bottom-2">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-lg">Background agents</CardTitle>
            <CardDescription>Autonomous sessions running behind the scenes.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {agents.length ? (
          agents.map((agent) => (
            <div key={agent.sessionId} className="rounded-lg border bg-background/60 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {agent.name ?? agent.sessionId}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {agent.parentSessionId ? `Parent ${agent.parentSessionId}` : agent.sessionId}
                  </div>
                </div>
                <Badge variant={agent.status === "running" ? "default" : "outline"} className="text-xs capitalize">
                  {agent.status}
                </Badge>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Cable className="h-3 w-3" />
                <span>{agent.pending > 0 ? `${agent.pending} pending` : "No pending work"}</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Activity className="h-3 w-3" />
                <span>{agent.updatedAt ? `Updated ${formatShortDate(agent.updatedAt)}` : "No updates yet"}</span>
              </div>
            </div>
          ))
        ) : (
          <EmptyState label="No background agents running." />
        )}
      </CardContent>
    </Card>
  );
}

function SessionsTable({ sessions }: { sessions: Session[] }) {
  return (
    <Card className="animate-in fade-in-0 slide-in-from-bottom-2">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-lg">Active sessions</CardTitle>
            <CardDescription>Live conversation threads and their latest activity.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {sessions.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead className="hidden md:table-cell">Updated</TableHead>
                <TableHead className="hidden lg:table-cell">Source</TableHead>
                <TableHead className="hidden xl:table-cell">Last message</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow key={session.sessionId} className="hover:bg-muted/50">
                  <TableCell>
                    {session.storageId ? (
                      <Link
                        href={`/sessions/${session.storageId}`}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {session.sessionId}
                      </Link>
                    ) : (
                      <div className="text-sm font-medium text-foreground">{session.sessionId}</div>
                    )}
                    <div className="text-xs text-muted-foreground lg:hidden">
                      {session.source ?? "unknown"}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                    {formatSessionTime(session)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <Badge variant="outline" className="text-xs">
                      {session.source ?? "unknown"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {session.lastMessage ?? "No message yet"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="gap-1">
                      <Sparkles className="h-3 w-3" />
                      Active
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState label="No sessions yet." />
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">{label}</div>;
}

function formatSessionTime(session: Session) {
  if (session.updatedAt) {
    return formatShortDate(session.updatedAt);
  }
  if (session.createdAt) {
    return formatShortDate(session.createdAt);
  }
  return "unknown";
}

function sortSessionsByActivity(sessions: Session[]) {
  const sessionTimestamp = (session: Session) => {
    const updated = session.updatedAt ? Date.parse(session.updatedAt) : Number.NaN;
    if (!Number.isNaN(updated)) {
      return updated;
    }
    const created = session.createdAt ? Date.parse(session.createdAt) : Number.NaN;
    if (!Number.isNaN(created)) {
      return created;
    }
    return 0;
  };

  return [...sessions].sort((a, b) => sessionTimestamp(b) - sessionTimestamp(a));
}

function buildActivitySeries(range: string, sessionCount: number, cronCount: number) {
  const points = range === "7d" ? 7 : range === "6h" ? 6 : 24;
  const stepMs = range === "7d" ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const now = Date.now();

  return Array.from({ length: points }).map((_, index) => {
    const timestamp = new Date(now - (points - 1 - index) * stepMs);
    const sessionBase = sessionCount || 0;
    const cronBase = cronCount || 0;
    const sessionValue = Math.max(0, Math.round(sessionBase + Math.sin(index / 2) * 2 + (index % 3)));
    const cronValue = Math.max(0, Math.round(cronBase + Math.cos(index / 2) * 1.5));

    return {
      timestamp: timestamp.toISOString(),
      sessions: sessionValue,
      cron: cronValue
    };
  });
}

function formatInterval(ms?: number) {
  if (!ms) {
    return "on demand";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${Math.round(ms / 1000)}s`;
  }
  if (ms < 3600000) {
    return `${Math.round(ms / 60000)}m`;
  }
  return `${Math.round(ms / 3600000)}h`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString();
}

function formatShortDate(value: string | number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
