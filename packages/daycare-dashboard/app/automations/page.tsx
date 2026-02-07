"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlarmClock,
  Cable,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  FolderOpen,
  HeartPulse,
  RefreshCw,
  Repeat,
  Shield,
  Zap
} from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchCronTasks, fetchHeartbeatTasks, type CronTask, type HeartbeatTask } from "@/lib/engine-client";

export default function AutomationsPage() {
  const [cronTasks, setCronTasks] = useState<CronTask[]>([]);
  const [heartbeatTasks, setHeartbeatTasks] = useState<HeartbeatTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cronData, heartbeatData] = await Promise.all([fetchCronTasks(), fetchHeartbeatTasks()]);
      setCronTasks(cronData);
      setHeartbeatTasks(heartbeatData);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load automations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const recurring = useMemo(() => cronTasks.filter((task) => !task.deleteAfterRun).length, [cronTasks]);
  const oneOff = useMemo(() => cronTasks.filter((task) => task.deleteAfterRun).length, [cronTasks]);
  const gated = useMemo(
    () => cronTasks.filter((t) => t.gate).length + heartbeatTasks.filter((t) => t.gate).length,
    [cronTasks, heartbeatTasks]
  );
  const totalTasks = cronTasks.length + heartbeatTasks.length;

  return (
    <DashboardShell
      title="Automations"
      subtitle="Cron schedules, heartbeat tasks, prompts, and execution details."
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
            <span>{totalTasks} tasks registered</span>
          )}
        </>
      }
    >
      <div className="flex flex-1 flex-col gap-6 px-4 py-6 lg:px-6">
        {/* Stats strip */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total tasks"
            value={totalTasks}
            detail="Automations registered"
            icon={<AlarmClock className="h-5 w-5" />}
            tone="primary"
          />
          <StatCard
            label="Cron"
            value={cronTasks.length}
            detail={`${recurring} recurring / ${oneOff} one-off`}
            icon={<Clock className="h-5 w-5" />}
            tone="amber"
          />
          <StatCard
            label="Heartbeat"
            value={heartbeatTasks.length}
            detail="Batch interval tasks"
            icon={<HeartPulse className="h-5 w-5" />}
            tone="rose"
          />
          <StatCard
            label="Gated"
            value={gated}
            detail="Tasks with gate conditions"
            icon={<Shield className="h-5 w-5" />}
            tone="emerald"
          />
        </div>

        {/* Tabs for cron / heartbeat */}
        <Tabs defaultValue="cron" className="flex flex-col gap-4">
          <TabsList className="self-start">
            <TabsTrigger value="cron" className="gap-2">
              <Clock className="h-3.5 w-3.5" />
              Cron tasks ({cronTasks.length})
            </TabsTrigger>
            <TabsTrigger value="heartbeat" className="gap-2">
              <HeartPulse className="h-3.5 w-3.5" />
              Heartbeat tasks ({heartbeatTasks.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cron" className="mt-0">
            {cronTasks.length ? (
              <div className="grid gap-4">
                {cronTasks.map((task, index) => (
                  <CronTaskCard key={task.id ?? `cron-${index}`} task={task} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<Clock className="h-8 w-8" />} label="No cron tasks scheduled" />
            )}
          </TabsContent>

          <TabsContent value="heartbeat" className="mt-0">
            {heartbeatTasks.length ? (
              <div className="grid gap-4">
                {heartbeatTasks.map((task) => (
                  <HeartbeatTaskCard key={task.id} task={task} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<HeartPulse className="h-8 w-8" />} label="No heartbeat tasks found" />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardShell>
  );
}

/* ── Stat card ────────────────────────────────────────────────────────── */

type StatCardProps = {
  label: string;
  value: number;
  detail: string;
  icon: React.ReactNode;
  tone: "primary" | "amber" | "rose" | "emerald";
};

const toneMap: Record<StatCardProps["tone"], { bg: string; text: string; gradient: string }> = {
  primary: { bg: "bg-primary/10", text: "text-primary", gradient: "from-primary/10 via-card to-card" },
  amber: { bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", gradient: "from-amber-500/10 via-card to-card" },
  rose: { bg: "bg-rose-500/10", text: "text-rose-600 dark:text-rose-400", gradient: "from-rose-500/10 via-card to-card" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", gradient: "from-emerald-500/10 via-card to-card" }
};

function StatCard({ label, value, detail, icon, tone }: StatCardProps) {
  const t = toneMap[tone];
  return (
    <Card className="relative overflow-hidden">
      <div className={`absolute inset-0 bg-gradient-to-br ${t.gradient}`} />
      <CardHeader className="relative flex flex-row items-center justify-between pb-2">
        <div>
          <CardDescription className="text-xs">{label}</CardDescription>
          <CardTitle className="text-3xl font-semibold tabular-nums">{value}</CardTitle>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${t.bg} ${t.text}`}>
          {icon}
        </div>
      </CardHeader>
      <CardContent className="relative text-xs text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}

/* ── Cron task card ───────────────────────────────────────────────────── */

function CronTaskCard({ task }: { task: CronTask }) {
  const [expanded, setExpanded] = useState(false);
  const isDisabled = task.enabled === false;

  return (
    <Card className={`transition-shadow hover:shadow-md ${isDisabled ? "opacity-60" : ""}`}>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base truncate">{task.name ?? task.id ?? "Unnamed task"}</CardTitle>
                {isDisabled && <Badge variant="secondary" className="text-[10px] uppercase">disabled</Badge>}
              </div>
              {task.description && (
                <CardDescription className="mt-0.5 line-clamp-2">{task.description}</CardDescription>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5 font-mono">
                  <Cable className="h-3 w-3" />
                  {task.schedule ?? "custom"}
                </span>
                <span className="flex items-center gap-1.5">
                  <Repeat className="h-3 w-3" />
                  {task.deleteAfterRun ? "Run once" : "Recurring"}
                </span>
                {task.lastRunAt && (
                  <span className="flex items-center gap-1.5">
                    <Zap className="h-3 w-3" />
                    Last run {formatRelativeTime(task.lastRunAt)}
                  </span>
                )}
                {task.gate && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Shield className="h-2.5 w-2.5" /> Gated
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <button className="mt-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="border-t pt-4 space-y-4">
          {/* Prompt */}
          {task.prompt && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                Prompt
              </div>
              <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/50 p-4 text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words font-mono">
                {task.prompt}
              </pre>
            </div>
          )}

          {/* Metadata grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetaField label="Task ID" value={task.id} mono />
            <MetaField label="Schedule" value={task.schedule ?? "custom"} mono />
            <MetaField label="Mode" value={task.deleteAfterRun ? "One-off (delete after run)" : "Recurring"} />
            {task.agentId && <MetaField label="Target agent" value={task.agentId} mono />}
            {task.lastRunAt && <MetaField label="Last run" value={formatShortDate(task.lastRunAt)} />}
            {task.enabled === false && <MetaField label="Enabled" value="No" />}
          </div>

          {/* Gate details */}
          {task.gate && <GateDetails gate={task.gate} />}

          {/* File paths */}
          {(task.taskPath || task.memoryPath || task.filesPath) && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <FolderOpen className="h-3.5 w-3.5" />
                File paths
              </div>
              <div className="space-y-1.5">
                {task.taskPath && <PathRow label="Task" value={task.taskPath} />}
                {task.memoryPath && <PathRow label="Memory" value={task.memoryPath} />}
                {task.filesPath && <PathRow label="Files" value={task.filesPath} />}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/* ── Heartbeat task card ──────────────────────────────────────────────── */

function HeartbeatTaskCard({ task }: { task: HeartbeatTask }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <HeartPulse className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base truncate">{task.title}</CardTitle>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="font-mono">{task.id}</span>
                {task.lastRunAt ? (
                  <span className="flex items-center gap-1.5">
                    <Zap className="h-3 w-3" />
                    Last run {formatRelativeTime(task.lastRunAt)}
                  </span>
                ) : (
                  <span className="italic">Never run</span>
                )}
                {task.gate ? (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Shield className="h-2.5 w-2.5" /> Gated
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">Always</Badge>
                )}
              </div>
            </div>
          </div>
          <button className="mt-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="border-t pt-4 space-y-4">
          {/* Prompt */}
          {task.prompt && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                Prompt
              </div>
              <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/50 p-4 text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words font-mono">
                {task.prompt}
              </pre>
            </div>
          )}

          {/* Metadata */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetaField label="Task ID" value={task.id} mono />
            {task.lastRunAt && <MetaField label="Last run" value={formatShortDate(task.lastRunAt)} />}
            {task.filePath && <MetaField label="File" value={task.filePath} mono />}
          </div>

          {/* Gate details */}
          {task.gate && <GateDetails gate={task.gate} />}
        </CardContent>
      )}
    </Card>
  );
}

/* ── Shared components ────────────────────────────────────────────────── */

function GateDetails({ gate }: { gate: NonNullable<CronTask["gate"]> }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Shield className="h-3.5 w-3.5" />
        Gate condition
      </div>
      <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Command:</span>
          <code className="rounded bg-muted px-2 py-0.5 font-mono text-foreground">{gate.command}</code>
        </div>
        {gate.cwd && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Working directory:</span>
            <code className="rounded bg-muted px-2 py-0.5 font-mono text-foreground">{gate.cwd}</code>
          </div>
        )}
        {gate.timeoutMs && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Timeout:</span>
            <span>{gate.timeoutMs}ms</span>
          </div>
        )}
        {gate.permissions && gate.permissions.length > 0 && (
          <div className="flex items-start gap-2 text-xs">
            <span className="text-muted-foreground shrink-0">Permissions:</span>
            <div className="flex flex-wrap gap-1">
              {gate.permissions.map((perm) => (
                <Badge key={perm} variant="outline" className="text-[10px] font-mono">{perm}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetaField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border bg-background/60 px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm text-foreground truncate ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-muted-foreground">{label}:</span>
      <code className="truncate rounded bg-muted px-2 py-0.5 font-mono text-foreground">{value}</code>
    </div>
  );
}

function EmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
          {icon}
        </div>
        <span className="text-sm">{label}</span>
      </CardContent>
    </Card>
  );
}

/* ── Formatters ───────────────────────────────────────────────────────── */

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}
