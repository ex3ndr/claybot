"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlarmClock, HeartPulse, RefreshCw } from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

  const recurring = useMemo(
    () => cronTasks.filter((task) => !task.deleteAfterRun).length,
    [cronTasks]
  );
  const oneOff = useMemo(() => cronTasks.filter((task) => task.deleteAfterRun).length, [cronTasks]);
  const totalTasks = cronTasks.length + heartbeatTasks.length;

  return (
    <DashboardShell
      title="Automations"
      subtitle="Track cron and heartbeat tasks, schedules, and automation health."
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
            <span>{totalTasks} tasks scheduled</span>
          )}
        </>
      }
    >
      <div className="flex flex-1 flex-col gap-6 px-4 py-6 lg:px-6">
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardDescription>Total tasks</CardDescription>
                <CardTitle className="text-2xl">{totalTasks}</CardTitle>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <AlarmClock className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Automations currently registered.</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Cron tasks</CardDescription>
              <CardTitle className="text-2xl">{cronTasks.length}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">File-backed scheduled prompts and jobs.</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Heartbeat tasks</CardDescription>
              <CardTitle className="text-2xl">{heartbeatTasks.length}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Batch prompts run on the heartbeat interval.</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Cron mix</CardDescription>
              <CardTitle className="text-2xl">{oneOff}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {recurring} recurring / {oneOff} one-off
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Cron tasks</CardTitle>
            <CardDescription>Latest scheduling details from the engine.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {cronTasks.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead className="hidden lg:table-cell">Details</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cronTasks.map((task, index) => (
                    <TableRow key={task.id ?? `task-${index}`}>
                      <TableCell>
                        <div className="text-sm font-medium text-foreground">{task.name ?? task.id ?? "task"}</div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{task.schedule ?? "custom"}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="text-xs text-muted-foreground">
                          {task.description ?? task.prompt ?? "custom"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={task.deleteAfterRun ? "outline" : "secondary"}>
                          {task.deleteAfterRun ? "once" : "repeat"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No cron tasks scheduled.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Heartbeat tasks</CardTitle>
            <CardDescription>Batch prompts executed at the engine heartbeat interval.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {heartbeatTasks.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Last run</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {heartbeatTasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <HeartPulse className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="text-sm font-medium text-foreground">{task.title}</div>
                            <div className="text-xs text-muted-foreground">{task.id}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {task.lastRunAt ? formatShortDate(task.lastRunAt) : "Never run"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={task.gate ? "secondary" : "outline"}>
                          {task.gate ? "gated" : "always"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No heartbeat tasks found.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
