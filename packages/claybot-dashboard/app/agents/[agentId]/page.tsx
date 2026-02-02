"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Clock, MessageSquare, RefreshCw } from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  fetchAgentHistory,
  fetchAgents,
  type AgentDescriptor,
  type AgentHistoryRecord,
  type AgentSummary,
  type EngineEvent
} from "@/lib/engine-client";
import { buildAgentType, formatAgentTypeLabel, formatAgentTypeObject } from "@/lib/agent-types";

type AgentDetailPageProps = {
  params: {
    agentId: string;
  };
};

export default function AgentDetailPage({ params }: AgentDetailPageProps) {
  const { agentId } = params;
  const [summary, setSummary] = useState<AgentSummary | null>(null);
  const [records, setRecords] = useState<AgentHistoryRecord[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const agentIdRef = useRef<string | null>(null);

  useEffect(() => {
    agentIdRef.current = summary?.agentId ?? null;
  }, [summary]);

  const refresh = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const silent = options.silent ?? false;
      if (!silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const [agents, agentRecords] = await Promise.all([fetchAgents(), fetchAgentHistory(agentId)]);
        const nextSummary = agents.find((agent) => agent.agentId === agentId) ?? null;
        setSummary(nextSummary);
        setRecords(agentRecords);
        setLastUpdated(new Date());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load agent");
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [agentId]
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
      if (payload.type === "agent.created" || payload.type === "agent.reset" || payload.type === "agent.restored") {
        const eventAgentId = (payload.payload as { agentId?: string } | undefined)?.agentId;
        const currentAgentId = agentIdRef.current;
        if (!currentAgentId || !eventAgentId || eventAgentId === currentAgentId) {
          void refresh({ silent: true });
        }
      }
    };

    return () => {
      source.close();
    };
  }, [refresh]);

  const orderedRecords = useMemo(() => {
    return [...records].sort((a, b) => recordTimestamp(b) - recordTimestamp(a));
  }, [records]);

  const recordStats = useMemo(() => {
    let userMessages = 0;
    let assistantMessages = 0;
    let toolResults = 0;
    let files = 0;
    records.forEach((record) => {
      if (record.type === "user_message") {
        userMessages += 1;
        files += record.files.length;
      }
      if (record.type === "assistant_message") {
        assistantMessages += 1;
        files += record.files.length;
      }
      if (record.type === "tool_result") {
        toolResults += 1;
        files += record.output.files.length;
      }
    });
    return { userMessages, assistantMessages, toolResults, files };
  }, [records]);

  const lastActivity = useMemo(() => {
    if (orderedRecords.length) {
      return formatDateTime(recordTimestamp(orderedRecords[0]));
    }
    if (summary?.updatedAt) {
      return formatDateTime(summary.updatedAt);
    }
    return "Unknown";
  }, [orderedRecords, summary]);

  const agentType = useMemo(() => {
    if (!summary) {
      return null;
    }
    return buildAgentType(summary);
  }, [summary]);

  return (
    <DashboardShell
      title={summary?.agentId ?? agentId}
      subtitle="Inspect the full conversation history for this agent."
      toolbar={
        <>
          <Button variant="outline" asChild className="gap-2">
            <Link href="/agents">
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
            <span>{orderedRecords.length} records</span>
          )}
        </>
      }
    >
      <div className="flex flex-1 flex-col gap-6 px-4 py-6 lg:px-6">
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="bg-gradient-to-br from-primary/10 via-card to-card/80">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardDescription>Agent id</CardDescription>
                <CardTitle className="text-xl">{summary?.agentId ?? agentId}</CardTitle>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageSquare className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Descriptor: {summary ? formatAgentDescriptor(summary.descriptor) : "Unknown"}
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-accent/10 via-card to-card/80">
            <CardHeader>
              <CardDescription>Agent type</CardDescription>
              <CardTitle className="text-xl">{agentType ? formatAgentTypeLabel(agentType) : "Unknown"}</CardTitle>
            </CardHeader>
            <CardContent className="text-[11px] text-muted-foreground">
              <span className="font-mono">{agentType ? formatAgentTypeObject(agentType) : "No context"}</span>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-slate-100/60 via-card to-card/80">
            <CardHeader>
              <CardDescription>Updated</CardDescription>
              <CardTitle className="text-xl">{summary ? formatDateTime(summary.updatedAt) : "Unknown"}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {summary ? "Agent state updated" : "Waiting for agent data"}
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-secondary/30 via-card to-card/80">
            <CardHeader>
              <CardDescription>Last activity</CardDescription>
              <CardTitle className="text-xl">{lastActivity}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {orderedRecords.length ? "Recent history recorded" : "Waiting for new activity"}
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Agent history</CardTitle>
                <CardDescription>Inbound, outbound, and tool activity tracked for this agent.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-xs">
                  {recordStats.userMessages} user
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {recordStats.assistantMessages} assistant
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {recordStats.toolResults} tools
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {recordStats.files} files
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {orderedRecords.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderedRecords.map((record, index) => {
                    const fileNames = getRecordFileNames(record);
                    return (
                      <TableRow key={`${record.type}-${recordTimestamp(record)}-${index}`} className="hover:bg-muted/50">
                        <TableCell className="text-xs text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <Clock className="h-3 w-3" />
                            <span>{formatDateTime(recordTimestamp(record))}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{formatRecordType(record)}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium text-foreground">
                            {formatRecordSummary(record)}
                          </div>
                          {fileNames ? (
                            <div className="text-xs text-muted-foreground">Files: {fileNames.join(", ")}</div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No history recorded yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}

function recordTimestamp(record: AgentHistoryRecord) {
  return record.at;
}

function formatRecordType(record: AgentHistoryRecord) {
  switch (record.type) {
    case "start":
      return "Started";
    case "reset":
      return "Reset";
    case "user_message":
      return "User";
    case "assistant_message":
      return "Assistant";
    case "tool_result":
      return "Tool";
    case "note":
      return "Note";
    default:
      return "Event";
  }
}

function formatRecordSummary(record: AgentHistoryRecord) {
  switch (record.type) {
    case "start":
      return "Agent started";
    case "reset":
      return "Agent reset";
    case "user_message":
      return record.text || (record.files.length ? `${record.files.length} file(s)` : "User message");
    case "assistant_message":
      if (record.text) {
        return record.text;
      }
      if (record.toolCalls.length) {
        return `${record.toolCalls.length} tool call${record.toolCalls.length === 1 ? "" : "s"}`;
      }
      return "Assistant message";
    case "tool_result":
      return `Tool result ${record.toolCallId}`;
    case "note":
      return record.text;
    default:
      return "Agent event";
  }
}

function getRecordFileNames(record: AgentHistoryRecord) {
  switch (record.type) {
    case "user_message":
      return record.files.map((file) => file.name);
    case "assistant_message":
      return record.files.map((file) => file.name);
    case "tool_result":
      return record.output.files.map((file) => file.name);
    default:
      return null;
  }
}

function formatAgentDescriptor(descriptor: AgentDescriptor) {
  switch (descriptor.type) {
    case "user":
      return `${descriptor.connector}:${descriptor.userId} / ${descriptor.channelId}`;
    case "cron":
      return `cron:${descriptor.id}`;
    case "heartbeat":
      return "heartbeat";
    case "subagent":
      return descriptor.name ? `${descriptor.name} / ${descriptor.id}` : descriptor.id;
    default:
      return "system";
  }
}

function formatDateTime(timestamp: number) {
  if (!Number.isFinite(timestamp)) {
    return "Unknown";
  }
  return new Date(timestamp).toLocaleString();
}
