export type EngineStatus = {
  plugins?: { id: string; pluginId: string; name: string }[];
  providers?: { id: string; name: string }[];
  connectors?: { id: string; name: string; pluginId?: string; loadedAt: string }[];
  inferenceProviders?: { id: string; name: string; label?: string }[];
  imageProviders?: { id: string; name: string; label?: string }[];
  tools?: string[];
};

export type ExecGate = {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  permissions?: string[];
  allowedDomains?: string[];
};

export type CronTask = {
  id: string;
  name?: string;
  description?: string;
  schedule?: string;
  prompt?: string;
  agentId?: string;
  gate?: ExecGate;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  lastRunAt?: string;
  taskPath?: string;
  memoryPath?: string;
  filesPath?: string;
};

export type HeartbeatTask = {
  id: string;
  title: string;
  gate?: ExecGate;
  lastRunAt?: string;
};

export type BackgroundAgentState = {
  agentId: string;
  name: string | null;
  parentAgentId: string | null;
  lifecycle: "active" | "sleeping";
  status: "running" | "queued" | "idle";
  pending: number;
  updatedAt: number;
};

export type FileReference = {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
};

export type MessageContext = {
  messageId?: string;
  permissionTags?: string[];
};

export type AgentDescriptor =
  | { type: "user"; connector: string; userId: string; channelId: string }
  | { type: "cron"; id: string }
  | { type: "heartbeat" }
  | { type: "subagent"; id: string; parentAgentId: string; name: string };

export type AgentSummary = {
  agentId: string;
  descriptor: AgentDescriptor;
  lifecycle: "active" | "sleeping";
  updatedAt: number;
};

export type AgentHistoryRecord =
  | { type: "start"; at: number }
  | { type: "reset"; at: number; message?: string }
  | { type: "user_message"; at: number; text: string; files: FileReference[] }
  | {
      type: "assistant_message";
      at: number;
      text: string;
      files: FileReference[];
      toolCalls: Record<string, unknown>[];
    }
  | {
      type: "tool_result";
      at: number;
      toolCallId: string;
      output: { toolMessage: Record<string, unknown>; files: FileReference[] };
    }
  | { type: "note"; at: number; text: string };

export type EngineEvent = {
  type: string;
  payload?: {
    status?: EngineStatus;
    cron?: CronTask[];
    heartbeat?: HeartbeatTask[];
    backgroundAgents?: BackgroundAgentState[];
  };
};

type EngineStatusResponse = {
  status: EngineStatus;
};

type CronResponse = {
  tasks?: CronTask[];
};

type HeartbeatResponse = {
  tasks?: HeartbeatTask[];
};

type BackgroundAgentsResponse = {
  agents?: BackgroundAgentState[];
};

type AgentsResponse = {
  agents?: AgentSummary[];
};

type AgentHistoryResponse = {
  records?: AgentHistoryRecord[];
};

async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchEngineStatus() {
  const data = await fetchJSON<EngineStatusResponse>("/api/v1/engine/status");
  return data.status ?? {};
}

export async function fetchCronTasks() {
  const data = await fetchJSON<CronResponse>("/api/v1/engine/cron/tasks");
  return data.tasks ?? [];
}

export async function fetchHeartbeatTasks() {
  const data = await fetchJSON<HeartbeatResponse>("/api/v1/engine/heartbeat/tasks");
  return data.tasks ?? [];
}

export async function fetchBackgroundAgents() {
  const data = await fetchJSON<BackgroundAgentsResponse>("/api/v1/engine/agents/background");
  return data.agents ?? [];
}

export async function fetchAgents() {
  const data = await fetchJSON<AgentsResponse>("/api/v1/engine/agents");
  return data.agents ?? [];
}

export async function fetchAgentHistory(agentId: string) {
  const encoded = encodeURIComponent(agentId);
  const data = await fetchJSON<AgentHistoryResponse>(`/api/v1/engine/agents/${encoded}/history`);
  return data.records ?? [];
}
