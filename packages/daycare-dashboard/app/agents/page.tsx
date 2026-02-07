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
import {
  fetchAgents,
  type AgentDescriptor,
  type AgentSummary,
  type EngineEvent
} from "@/lib/engine-client";
import { buildAgentType, formatAgentTypeLabel, formatAgentTypeObject } from "@/lib/agent-types";

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const syncAgents = useCallback(async (options: { silent?: boolean } = {}) => {
    const silent = options.silent ?? false;
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await fetchAgents();
      setAgents(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void syncAgents();
  }, [syncAgents]);

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
        void syncAgents({ silent: true });
        return;
      }

      if (payload.type === "agent.created" || payload.type === "agent.reset" || payload.type === "agent.restored") {
        void syncAgents({ silent: true });
      }
    };

    return () => {
      source.close();
    };
  }, [syncAgents]);

  const orderedAgents = useMemo(() => {
    return [...agents].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [agents]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return orderedAgents.filter((agent) => {
      const agentType = buildAgentType(agent);
      if (typeFilter !== "all" && agentType.type !== typeFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return buildAgentSearchText(agent, agentType).includes(normalizedQuery);
    });
  }, [orderedAgents, query, typeFilter]);

  const types = useMemo(() => new Set(agents.map((agent) => buildAgentType(agent).type)), [agents]);
  const typeOptions = useMemo(() => ["all", ...Array.from(types).sort()], [types]);
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    agents.forEach((agent) => {
      const key = buildAgentType(agent).type;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [agents]);

  const mostRecentAgent = orderedAgents[0] ?? null;
  const lastActivity = mostRecentAgent ? formatAgentTime(mostRecentAgent) : "No activity";

  return (
    <DashboardShell
      title="Agents"
      subtitle="Inspect live conversation threads and active agents."
      toolbar={
        <>
          <div className="relative hidden w-56 items-center md:flex">
            <Search className="absolute left-2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search agents"
              className="h-9 pl-8"
              aria-label="Search agents"
            />
          </div>
          <Badge variant={connected ? "default" : "outline"} className={connected ? "bg-emerald-500 text-white" : ""}>
            {connected ? "Live" : "Offline"}
          </Badge>
          <Button onClick={() => void syncAgents()} disabled={loading} className="gap-2">
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
                <CardDescription>Total agents</CardDescription>
                <CardTitle className="text-2xl">{agents.length}</CardTitle>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageSquare className="h-5 w-5" />
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Active threads discovered from the engine.</CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-accent/10 via-card to-card/80">
            <CardHeader>
              <CardDescription>Agent types</CardDescription>
              <CardTitle className="text-2xl">{types.size}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {typeCounts.length
                ? typeCounts
                    .slice(0, 3)
                    .map((entry) => `${formatAgentTypeKey(entry.type)} (${entry.count})`)
                    .join(", ")
                : "No agents yet"}
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-secondary/30 via-card to-card/80">
            <CardHeader>
              <CardDescription>Latest activity</CardDescription>
              <CardTitle className="text-lg">{lastActivity}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {mostRecentAgent ? `Agent ${mostRecentAgent.agentId} updated` : "Waiting for the first agent."}
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Active agents</CardTitle>
                <CardDescription>All active agent activity from the engine.</CardDescription>
              </div>
              <div className="relative w-full md:hidden">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search agents"
                  className="h-9 pl-8"
                  aria-label="Search agents"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {typeOptions.map((type) => (
                  <Button
                    key={type}
                    size="sm"
                    variant={typeFilter === type ? "default" : "outline"}
                    onClick={() => setTypeFilter(type)}
                    className="capitalize"
                  >
                    {type === "all" ? "All" : formatAgentTypeKey(type)}
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
                    <TableHead>Agent</TableHead>
                    <TableHead className="hidden md:table-cell">Updated</TableHead>
                    <TableHead className="hidden lg:table-cell">Descriptor</TableHead>
                    <TableHead className="hidden xl:table-cell">Type</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((agent) => {
                    const agentType = buildAgentType(agent);
                    return (
                      <TableRow key={agent.agentId} className="hover:bg-muted/50">
                        <TableCell>
                          <Link
                            href={`/agents/${agent.agentId}`}
                            className="text-sm font-medium text-foreground hover:underline"
                          >
                            {agent.agentId}
                          </Link>
                          <div className="text-xs text-muted-foreground lg:hidden">
                            {formatAgentDescriptor(agent.descriptor)}
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground lg:hidden">
                            {formatAgentTypeLabel(agentType)}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                          {formatAgentTime(agent)}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <span className="text-xs text-muted-foreground">
                            {formatAgentDescriptor(agent.descriptor)}
                          </span>
                        </TableCell>
                        <TableCell className="hidden xl:table-cell">
                          <div className="flex flex-col gap-1">
                            <Badge variant="outline" className="text-[11px]">
                              {formatAgentTypeLabel(agentType)}
                            </Badge>
                            <span className="line-clamp-2 font-mono text-[10px] text-muted-foreground">
                              {formatAgentTypeObject(agentType)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={agent.lifecycle === "sleeping" ? "outline" : "secondary"}
                            className="capitalize"
                          >
                            {agent.lifecycle}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No agents match this filter.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  );
}

function formatAgentTime(agent: AgentSummary) {
  return new Date(agent.updatedAt).toLocaleString();
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

function buildAgentSearchText(agent: AgentSummary, agentType = buildAgentType(agent)) {
  return `${agent.agentId} ${formatAgentDescriptor(agent.descriptor)} ${formatAgentTypeLabel(agentType)} ${agent.lifecycle}`.toLowerCase();
}

function formatAgentTypeKey(type: string) {
  switch (type) {
    case "connection":
      return "Connection";
    case "cron":
      return "Cron";
    case "heartbeat":
      return "Heartbeat";
    case "subagent":
      return "Subagent";
    case "permanent":
      return "Permanent";
    case "system":
      return "System";
    default:
      return "Agent";
  }
}
