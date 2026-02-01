export type EngineStatus = {
  plugins?: { id: string; pluginId: string; name: string }[];
  providers?: { id: string; name: string }[];
  connectors?: { id: string; name: string; pluginId?: string; loadedAt: string }[];
  inferenceProviders?: { id: string; name: string; label?: string }[];
  imageProviders?: { id: string; name: string; label?: string }[];
  tools?: string[];
};

export type CronTask = {
  id: string;
  name?: string;
  description?: string;
  schedule?: string;
  prompt?: string;
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
  lastRunAt?: string;
};

export type BackgroundAgentState = {
  sessionId: string;
  storageId: string;
  name?: string;
  parentSessionId?: string;
  status: "running" | "queued" | "idle";
  pending: number;
  updatedAt?: string;
};

export type SessionContext = {
  channelId: string;
  channelType?: "private" | "group" | "supergroup" | "channel" | "unknown";
  userId: string;
  userFirstName?: string;
  userLastName?: string;
  username?: string;
  sessionId?: string;
  messageId?: string;
  providerId?: string;
  agent?: {
    kind: "background";
    parentSessionId?: string;
    name?: string;
  };
  cron?: {
    taskId: string;
    taskUid: string;
    taskName: string;
    memoryPath: string;
    filesPath: string;
  };
  heartbeat?: {
    title: string;
  };
};

export type Session = {
  sessionId: string;
  storageId: string;
  source?: string;
  context?: SessionContext;
  lastMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type SessionEntry =
  | {
      type: "session_created";
      sessionId: string;
      storageId: string;
      source: string;
      context: Record<string, unknown>;
      createdAt: string;
    }
  | {
      type: "incoming";
      sessionId: string;
      storageId: string;
      source: string;
      messageId: string;
      context: Record<string, unknown>;
      text: string | null;
      files?: Array<{
        id: string;
        name: string;
        mimeType: string;
        size: number;
        path: string;
      }>;
      receivedAt: string;
    }
  | {
      type: "outgoing";
      sessionId: string;
      storageId: string;
      source: string;
      messageId: string;
      context: Record<string, unknown>;
      text: string | null;
      files?: Array<{
        id: string;
        name: string;
        mimeType: string;
        size: number;
        path: string;
      }>;
      sentAt: string;
    }
  | {
      type: "state";
      sessionId: string;
      storageId: string;
      updatedAt: string;
      state: Record<string, unknown>;
    };

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

type SessionsResponse = {
  sessions?: Session[];
};

type SessionEntriesResponse = {
  entries?: SessionEntry[];
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

export async function fetchSessions() {
  const data = await fetchJSON<SessionsResponse>("/api/v1/engine/sessions");
  return data.sessions ?? [];
}

export async function fetchSessionEntries(storageId: string) {
  const encoded = encodeURIComponent(storageId);
  const data = await fetchJSON<SessionEntriesResponse>(`/api/v1/engine/sessions/${encoded}`);
  return data.entries ?? [];
}
