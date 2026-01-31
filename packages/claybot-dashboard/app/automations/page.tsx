"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlarmClock, RefreshCw } from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchCronTasks, type CronTask } from "@/lib/engine-client";

export default function AutomationsPage() {
  const [tasks, setTasks] = useState<CronTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCronTasks();
      setTasks(data);
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

  const recurring = useMemo(() => tasks.filter((task) => !task.deleteAfterRun).length, [tasks]);
  const oneOff = useMemo(() => tasks.filter((task) => task.deleteAfterRun).length, [tasks]);

  return (
    <DashboardShell
      title="Automations"
      subtitle="Track cron schedules, triggers, and automation health."
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
            <span>{tasks.length} tasks scheduled</span>
          )}
        </>
      }
    >
      <div className="flex flex-1 flex-col gap-6 px-4 py-6 lg:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardDescription>Total tasks</CardDescription>
                <CardTitle className="text-2xl">{tasks.length}</CardTitle>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <AlarmClock className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Automations currently registered.</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Recurring</CardDescription>
              <CardTitle className="text-2xl">{recurring}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Repeating schedules driving engine activity.</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>One-off</CardDescription>
              <CardTitle className="text-2xl">{oneOff}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Single-run jobs and ad-hoc triggers.</CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Cron tasks</CardTitle>
            <CardDescription>Latest scheduling details from the engine.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {tasks.length ? (
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
                  {tasks.map((task, index) => (
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
      </div>
    </DashboardShell>
  );
}
