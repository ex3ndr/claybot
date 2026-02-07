"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Clock, MessageSquare, RefreshCw } from "lucide-react";

import { DashboardShell } from "@/components/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
          {summary?.lifecycle ? (
            <Badge variant={summary.lifecycle === "sleeping" ? "outline" : "secondary"} className="capitalize">
              {summary.lifecycle}
            </Badge>
          ) : null}
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
      <div className="flex flex-1 flex-col gap-6 overflow-hidden px-4 py-6 lg:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="overflow-hidden bg-gradient-to-br from-primary/10 via-card to-card/80">
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="min-w-0 flex-1">
                <CardDescription>Agent id</CardDescription>
                <CardTitle className="truncate text-xl" title={summary?.agentId ?? agentId}>{summary?.agentId ?? agentId}</CardTitle>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageSquare className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="truncate text-xs text-muted-foreground" title={summary ? formatAgentDescriptor(summary.descriptor) : "Unknown"}>
              Descriptor: {summary ? formatAgentDescriptor(summary.descriptor) : "Unknown"}
            </CardContent>
          </Card>
          <Card className="overflow-hidden bg-gradient-to-br from-accent/10 via-card to-card/80">
            <CardHeader>
              <CardDescription>Agent type</CardDescription>
              <CardTitle className="text-xl">{agentType ? formatAgentTypeLabel(agentType) : "Unknown"}</CardTitle>
            </CardHeader>
            <CardContent className="text-[11px] text-muted-foreground">
              <span className="block truncate font-mono" title={agentType ? formatAgentTypeObject(agentType) : "No context"}>{agentType ? formatAgentTypeObject(agentType) : "No context"}</span>
            </CardContent>
          </Card>
          <Card className="overflow-hidden bg-gradient-to-br from-slate-100/60 via-card to-card/80">
            <CardHeader>
              <CardDescription>Updated</CardDescription>
              <CardTitle className="truncate text-xl">{summary ? formatDateTime(summary.updatedAt) : "Unknown"}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {summary ? `Lifecycle: ${summary.lifecycle}` : "Waiting for agent data"}
            </CardContent>
          </Card>
          <Card className="overflow-hidden bg-gradient-to-br from-secondary/30 via-card to-card/80">
            <CardHeader>
              <CardDescription>Last activity</CardDescription>
              <CardTitle className="truncate text-xl">{lastActivity}</CardTitle>
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
              <div className="space-y-4">
                {orderedRecords.map((record, index) => (
                  <div
                    key={`${record.type}-${recordTimestamp(record)}-${index}`}
                    className={`overflow-hidden rounded-lg border bg-background p-4 shadow-sm ${recordAccent(record)}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span className="whitespace-nowrap">{formatDateTime(recordTimestamp(record))}</span>
                      </div>
                      <Badge variant="outline" className={`shrink-0 ${recordBadge(record)}`}>
                        {formatRecordType(record)}
                      </Badge>
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        {formatRecordSummary(record)}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3">
                      {renderRecordDetails(record)}
                    </div>
                  </div>
                ))}
              </div>
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
      return record.message ? truncateText(record.message, 140) : "Agent reset";
    case "user_message":
      return record.text
        ? truncateText(record.text, 140)
        : record.files.length
          ? `${record.files.length} file(s)`
          : "User message";
    case "assistant_message":
      if (record.text) {
        return truncateText(record.text, 140);
      }
      if (record.toolCalls.length) {
        return `${record.toolCalls.length} tool call${record.toolCalls.length === 1 ? "" : "s"}`;
      }
      return "Assistant message";
    case "tool_result":
      return `Tool result ${record.toolCallId}`;
    case "note":
      return truncateText(record.text, 140);
    default:
      return "Agent event";
  }
}

function renderRecordDetails(record: AgentHistoryRecord) {
  switch (record.type) {
    case "start":
      return <RecordSection title="Status">Agent started.</RecordSection>;
    case "reset":
      return (
        <>
          <RecordSection title="Status">Agent reset.</RecordSection>
          {record.message ? <RecordSection title="Reason">{record.message}</RecordSection> : null}
        </>
      );
    case "user_message":
      return (
        <>
          <RecordSection title="Message">
            {record.text ? (
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">{record.text}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No text provided.</p>
            )}
          </RecordSection>
          {renderFilesSection(record.files)}
        </>
      );
    case "assistant_message":
      return (
        <>
          <RecordSection title="Response">
            {record.text ? (
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">{record.text}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No assistant text captured.</p>
            )}
          </RecordSection>
          {renderToolCallsSection(record.toolCalls)}
          {renderFilesSection(record.files)}
        </>
      );
    case "tool_result":
      return (
        <>
          <RecordSection title="Tool result">
            <KeyValueList
              items={buildToolResultMeta(record)}
              emptyLabel="No tool metadata captured."
            />
          </RecordSection>
          <RecordSection title="Tool output">
            <JsonBlock value={record.output.toolMessage} />
          </RecordSection>
          {renderFilesSection(record.output.files)}
        </>
      );
    case "note":
      return <RecordSection title="Note">{record.text}</RecordSection>;
    default:
      return <RecordSection title="Event">Recorded agent activity.</RecordSection>;
  }
}

function renderFilesSection(files: Array<{ name: string; path: string; mimeType: string; size: number }>) {
  if (!files.length) {
    return null;
  }
  return (
    <RecordSection title={`Files (${files.length})`}>
      <div className="grid gap-2">
        {files.map((file) => (
          <div key={file.path} className="rounded-md border bg-muted/40 p-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-foreground">{file.name}</span>
              <span className="text-muted-foreground">{formatFileSize(file.size)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
              <span>{file.mimeType}</span>
              <span className="truncate font-mono" title={file.path}>{file.path}</span>
            </div>
          </div>
        ))}
      </div>
    </RecordSection>
  );
}

function renderToolCallsSection(toolCalls: Record<string, unknown>[]) {
  if (!toolCalls.length) {
    return null;
  }
  return (
    <RecordSection title={`Tool calls (${toolCalls.length})`}>
      <div className="grid gap-3">
        {toolCalls.map((toolCall, index) => {
          const meta = parseToolCall(toolCall);
          return (
            <div key={meta.id ?? `${meta.name ?? "tool"}-${index}`} className="rounded-md border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary" className="font-mono">
                  {meta.name ?? "unknown"}
                </Badge>
                {meta.id ? <span className="truncate text-muted-foreground">id: {meta.id}</span> : null}
                {meta.type ? <span className="text-muted-foreground">type: {meta.type}</span> : null}
              </div>
              <div className="mt-2">
                <JsonBlock value={meta.arguments ?? {}} />
              </div>
            </div>
          );
        })}
      </div>
    </RecordSection>
  );
}

function buildToolResultMeta(record: Extract<AgentHistoryRecord, { type: "tool_result" }>) {
  const toolMessageMeta = parseToolMessage(record.output.toolMessage);
  const items = [
    { label: "Tool call id", value: record.toolCallId },
    ...(toolMessageMeta.name ? [{ label: "Tool name", value: toolMessageMeta.name }] : []),
    ...(toolMessageMeta.status ? [{ label: "Status", value: toolMessageMeta.status }] : []),
    ...(toolMessageMeta.role ? [{ label: "Role", value: toolMessageMeta.role }] : []),
    ...(toolMessageMeta.type ? [{ label: "Type", value: toolMessageMeta.type }] : [])
  ];
  return items;
}

function parseToolCall(toolCall: Record<string, unknown>) {
  const id = typeof toolCall.id === "string" ? toolCall.id : null;
  const name = typeof toolCall.name === "string" ? toolCall.name : null;
  const type = typeof toolCall.type === "string" ? toolCall.type : null;
  const args = Object.prototype.hasOwnProperty.call(toolCall, "arguments")
    ? (toolCall as { arguments?: unknown }).arguments
    : null;
  return { id, name, type, arguments: args };
}

function parseToolMessage(message: Record<string, unknown>) {
  const name = typeof message.name === "string" ? message.name : null;
  const status = typeof message.status === "string" ? message.status : null;
  const role = typeof message.role === "string" ? message.role : null;
  const type = typeof message.type === "string" ? message.type : null;
  return { name, status, role, type };
}

function RecordSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-dashed bg-muted/30 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-2 min-w-0 text-sm text-foreground">{children}</div>
    </section>
  );
}

function KeyValueList({ items, emptyLabel }: { items: Array<{ label: string; value: ReactNode }>; emptyLabel: string }) {
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <dl className="grid gap-2 text-sm md:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 space-y-1">
          <dt className="text-[11px] uppercase text-muted-foreground">{item.label}</dt>
          <dd className="truncate font-medium text-foreground" title={typeof item.value === "string" ? item.value : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-foreground">
      {formatJson(value)}
    </pre>
  );
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return error instanceof Error ? error.message : String(value);
  }
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size)) {
    return "Unknown size";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function recordBadge(record: AgentHistoryRecord) {
  switch (record.type) {
    case "start":
      return "border-emerald-200 text-emerald-700";
    case "reset":
      return "border-rose-200 text-rose-700";
    case "user_message":
      return "border-sky-200 text-sky-700";
    case "assistant_message":
      return "border-indigo-200 text-indigo-700";
    case "tool_result":
      return "border-amber-200 text-amber-700";
    case "note":
      return "border-slate-200 text-slate-700";
    default:
      return "border-muted-foreground/30 text-muted-foreground";
  }
}

function recordAccent(record: AgentHistoryRecord) {
  switch (record.type) {
    case "start":
      return "border-l-4 border-l-emerald-400";
    case "reset":
      return "border-l-4 border-l-rose-400";
    case "user_message":
      return "border-l-4 border-l-sky-400";
    case "assistant_message":
      return "border-l-4 border-l-indigo-400";
    case "tool_result":
      return "border-l-4 border-l-amber-400";
    case "note":
      return "border-l-4 border-l-slate-400";
    default:
      return "border-l-4 border-l-muted";
  }
}

function truncateText(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function formatAgentDescriptor(descriptor: AgentDescriptor) {
  switch (descriptor.type) {
    case "user":
      return `${descriptor.connector}:${descriptor.userId} / ${descriptor.channelId}`;
    case "cron":
      return `cron:${descriptor.id}`;
    case "system":
      return `system:${descriptor.tag}`;
    case "subagent":
      return descriptor.name ? `${descriptor.name} / ${descriptor.id}` : descriptor.id;
    case "permanent":
      return `${descriptor.name} / ${descriptor.id}`;
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
