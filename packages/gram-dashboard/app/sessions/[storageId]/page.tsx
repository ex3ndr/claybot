"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Clock, MessageSquare, RefreshCw } from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchSessionEntries, fetchSessions, type EngineEvent, type Session, type SessionEntry } from "@/lib/engine-client";

type SessionDetailPageProps = {
  params: {
    storageId: string;
  };
};

export default function SessionDetailPage({ params }: SessionDetailPageProps) {
  const { storageId } = params;
  const [summary, setSummary] = useState<Session | null>(null);
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = summary?.sessionId ?? null;
  }, [summary]);

  const refresh = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const silent = options.silent ?? false;
      if (!silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const [sessions, sessionEntries] = await Promise.all([
          fetchSessions(),
          fetchSessionEntries(storageId)
        ]);
        const nextSummary = sessions.find((session) => session.storageId === storageId) ?? null;
        setSummary(nextSummary);
        setEntries(sessionEntries);
        setLastUpdated(new Date());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load session");
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [storageId]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
        void refresh({ silent: true });
        return;
      }
      if (payload.type === "session.created" || payload.type === "session.updated") {
        const eventSessionId = (payload.payload as { sessionId?: string } | undefined)?.sessionId;
        const currentSessionId = sessionIdRef.current;
        if (!currentSessionId || !eventSessionId || eventSessionId === currentSessionId) {
          void refresh({ silent: true });
        }
      }
    };

    return () => {
      source.close();
    };
  }, [refresh]);

  const orderedEntries = useMemo(() => {
    return [...entries].sort((a, b) => entryTimestamp(b) - entryTimestamp(a));
  }, [entries]);
  const entryStats = useMemo(() => {
    let incoming = 0;
    let outgoing = 0;
    let files = 0;
    entries.forEach((entry) => {
      if (entry.type === "incoming") {
        incoming += 1;
        files += entry.files?.length ?? 0;
      }
      if (entry.type === "outgoing") {
        outgoing += 1;
        files += entry.files?.length ?? 0;
      }
    });
    return { incoming, outgoing, files };
  }, [entries]);

  const lastActivity = useMemo(() => {
    if (orderedEntries.length) {
      return formatDateTime(entryTimestamp(orderedEntries[0]));
    }
    if (summary?.updatedAt) {
      return formatDateTime(Date.parse(summary.updatedAt));
    }
    if (summary?.createdAt) {
      return formatDateTime(Date.parse(summary.createdAt));
    }
    return "Unknown";
  }, [orderedEntries, summary]);

  return (
    <DashboardShell
      title={summary?.sessionId ?? storageId}
      subtitle="Inspect the full conversation history for this session."
      toolbar={
        <>
          <Button variant="outline" asChild className="gap-2">
            <Link href="/sessions">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </Button>
          <Badge variant={connected ? "default" : "outline"} className={connected ? "bg-emerald-500 text-white" : ""}>
            {connected ? "Live" : "Offline"}
          </Badge>
          <Button onClick={() => void refresh()} disabled={loading} className="gap-2">
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
            <span>{orderedEntries.length} entries</span>
          )}
        </>
      }
    >
      <div className="flex flex-1 flex-col gap-6 px-4 py-6 lg:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="bg-gradient-to-br from-primary/10 via-card to-card/80">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardDescription>Session id</CardDescription>
                <CardTitle className="text-xl">{summary?.sessionId ?? storageId}</CardTitle>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageSquare className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Storage id: {storageId}</CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-accent/10 via-card to-card/80">
            <CardHeader>
              <CardDescription>Source</CardDescription>
              <CardTitle className="text-xl">{summary?.source ?? "unknown"}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {summary?.createdAt ? `Created ${formatDateTime(Date.parse(summary.createdAt))}` : "Creation time unknown"}
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-secondary/30 via-card to-card/80">
            <CardHeader>
              <CardDescription>Last activity</CardDescription>
              <CardTitle className="text-xl">{lastActivity}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {summary?.updatedAt ? "Updated recently" : "Waiting for new activity"}
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Session log</CardTitle>
                <CardDescription>Inbound and outbound messages tracked for this session.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-xs">
                  {entryStats.incoming} incoming
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {entryStats.outgoing} outgoing
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {entryStats.files} files
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {orderedEntries.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderedEntries.map((entry, index) => {
                    const fileNames = getFileNames(entry);
                    return (
                      <TableRow key={`${entry.type}-${entryTimestamp(entry)}-${index}`} className="hover:bg-muted/50">
                        <TableCell className="text-xs text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <Clock className="h-3 w-3" />
                            <span>{formatDateTime(entryTimestamp(entry))}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{formatEntryType(entry)}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium text-foreground">
                            {formatEntrySummary(entry)}
                          </div>
                          {fileNames ? (
                            <div className="text-xs text-muted-foreground">
                              Files: {fileNames.join(", ")}
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No entries recorded yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}

function entryTimestamp(entry: SessionEntry) {
  let timestamp = 0;
  switch (entry.type) {
    case "incoming":
      timestamp = Date.parse(entry.receivedAt);
      break;
    case "outgoing":
      timestamp = Date.parse(entry.sentAt);
      break;
    case "session_created":
      timestamp = Date.parse(entry.createdAt);
      break;
    case "state":
      timestamp = Date.parse(entry.updatedAt);
      break;
    default:
      timestamp = 0;
  }
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatEntryType(entry: SessionEntry) {
  switch (entry.type) {
    case "incoming":
      return "Incoming";
    case "outgoing":
      return "Outgoing";
    case "session_created":
      return "Created";
    case "state":
      return "State";
    default:
      return "Event";
  }
}

function formatEntrySummary(entry: SessionEntry) {
  if (entry.type === "incoming" || entry.type === "outgoing") {
    if (entry.text) {
      return entry.text;
    }
    if (entry.files?.length) {
      return `${entry.files.length} file${entry.files.length === 1 ? "" : "s"}`;
    }
    return "Message received";
  }
  if (entry.type === "session_created") {
    return "Session created";
  }
  if (entry.type === "state") {
    return "State updated";
  }
  return "Session event";
}

function getFileNames(entry: SessionEntry) {
  if (entry.type === "incoming" || entry.type === "outgoing") {
    return entry.files?.map((file) => file.name) ?? null;
  }
  return null;
}

function formatDateTime(timestamp: number) {
  if (!Number.isFinite(timestamp)) {
    return "Unknown";
  }
  return new Date(timestamp).toLocaleString();
}
