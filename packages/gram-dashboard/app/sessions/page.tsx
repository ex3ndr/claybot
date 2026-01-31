"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, RefreshCw, Search } from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchSessions, type EngineEvent, type Session } from "@/lib/engine-client";

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const syncSessions = useCallback(async (options: { silent?: boolean } = {}) => {
    const silent = options.silent ?? false;
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await fetchSessions();
      setSessions(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void syncSessions();
  }, [syncSessions]);

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
        void syncSessions({ silent: true });
        return;
      }

      if (payload.type === "session.created" || payload.type === "session.updated") {
        void syncSessions({ silent: true });
      }
    };

    return () => {
      source.close();
    };
  }, [syncSessions]);

  const orderedSessions = useMemo(() => {
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
  }, [sessions]);

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return sourceFilter === "all"
        ? orderedSessions
        : orderedSessions.filter((session) => (session.source ?? "unknown") === sourceFilter);
    }
    const q = query.toLowerCase();
    return orderedSessions.filter((session) => {
      if (sourceFilter !== "all" && (session.source ?? "unknown") !== sourceFilter) {
        return false;
      }
      return (
        session.sessionId.toLowerCase().includes(q) ||
        (session.source ?? "").toLowerCase().includes(q) ||
        (session.lastMessage ?? "").toLowerCase().includes(q)
      );
    });
  }, [query, orderedSessions, sourceFilter]);

  const sources = useMemo(() => new Set(sessions.map((session) => session.source ?? "unknown")), [sessions]);
  const sourceOptions = useMemo(() => ["all", ...Array.from(sources).sort()], [sources]);
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    sessions.forEach((session) => {
      const key = session.source ?? "unknown";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);
  }, [sessions]);

  return (
    <DashboardShell
      title="Sessions"
      subtitle="Inspect live conversation threads and active sessions."
      toolbar={
        <>
          <div className="relative hidden w-56 items-center md:flex">
            <Search className="absolute left-2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sessions"
              className="h-9 pl-8"
              aria-label="Search sessions"
            />
          </div>
          <Badge variant={connected ? "default" : "outline"} className={connected ? "bg-emerald-500 text-white" : ""}>
            {connected ? "Live" : "Offline"}
          </Badge>
          <Button onClick={() => void syncSessions()} disabled={loading} className="gap-2">
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh
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
            <span>Filtered results: {filtered.length}</span>
          )}
        </>
      }
    >
      <div className="flex flex-1 flex-col gap-6 px-4 py-6 lg:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="bg-gradient-to-br from-primary/10 via-card to-card/80">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardDescription>Total sessions</CardDescription>
                <CardTitle className="text-2xl">{sessions.length}</CardTitle>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageSquare className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Active threads discovered from the engine.</CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-accent/10 via-card to-card/80">
            <CardHeader>
              <CardDescription>Sources</CardDescription>
              <CardTitle className="text-2xl">{sources.size}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {Array.from(sources).slice(0, 3).join(", ") || "No sources yet"}
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-secondary/30 via-card to-card/80">
            <CardHeader>
              <CardDescription>Last message preview</CardDescription>
              <CardTitle className="text-lg">{sessions[0]?.lastMessage ? "Updated" : "No activity"}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground line-clamp-2">
              {sessions[0]?.lastMessage ?? "Waiting for the first session update."}
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Active sessions</CardTitle>
                <CardDescription>All active session activity from the engine.</CardDescription>
              </div>
              <div className="relative w-full md:hidden">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search sessions"
                  className="h-9 pl-8"
                  aria-label="Search sessions"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {sourceOptions.map((source) => (
                  <Button
                    key={source}
                    size="sm"
                    variant={sourceFilter === source ? "default" : "outline"}
                    onClick={() => setSourceFilter(source)}
                    className="capitalize"
                  >
                    {source}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {filtered.length ? (
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
                  {filtered.map((session) => (
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
                        <div className="text-xs text-muted-foreground lg:hidden">{session.source ?? "unknown"}</div>
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
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                          Active
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No sessions match this filter.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-background/70">
          <CardHeader>
            <CardTitle>Source distribution</CardTitle>
            <CardDescription>Active sessions grouped by connector source.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {sourceCounts.length ? (
              sourceCounts.map((item) => (
                <Badge key={item.source} variant="secondary" className="gap-2 text-xs">
                  {item.source}
                  <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                    {item.count}
                  </span>
                </Badge>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">No sources reported yet.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}

function formatSessionTime(session: Session) {
  if (session.updatedAt) {
    return new Date(session.updatedAt).toLocaleString();
  }
  if (session.createdAt) {
    return new Date(session.createdAt).toLocaleString();
  }
  return "unknown";
}
