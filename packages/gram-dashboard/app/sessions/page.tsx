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
      return orderedSessions;
    }
    const q = query.toLowerCase();
    return orderedSessions.filter((session) => {
      return (
        session.sessionId.toLowerCase().includes(q) ||
        (session.source ?? "").toLowerCase().includes(q) ||
        (session.lastMessage ?? "").toLowerCase().includes(q)
      );
    });
  }, [query, orderedSessions]);

  const sources = useMemo(() => new Set(sessions.map((session) => session.source ?? "unknown")), [sessions]);

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
          <Card>
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
          <Card>
            <CardHeader>
              <CardDescription>Sources</CardDescription>
              <CardTitle className="text-2xl">{sources.size}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {Array.from(sources).slice(0, 3).join(", ") || "No sources yet"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Last message preview</CardDescription>
              <CardTitle className="text-lg">{sessions[0]?.lastMessage ? "Updated" : "No activity"}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground line-clamp-2">
              {sessions[0]?.lastMessage ?? "Waiting for the first session update."}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>All active session activity from the engine.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {filtered.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Session</TableHead>
                    <TableHead className="hidden lg:table-cell">Source</TableHead>
                    <TableHead className="hidden xl:table-cell">Last message</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((session) => (
                    <TableRow key={session.sessionId}>
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
                      <TableCell className="hidden lg:table-cell">{session.source ?? "unknown"}</TableCell>
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
      </div>
    </DashboardShell>
  );
}
