export type EngineStatus = {
  plugins?: { id: string; pluginId: string; name: string }[];
  providers?: { id: string; name: string }[];
  connectors?: { id: string; name: string; pluginId?: string; loadedAt: string }[];
  inferenceProviders?: { id: string; name: string; label?: string }[];
  imageProviders?: { id: string; name: string; label?: string }[];
  tools?: string[];
};

export type CronTask = {
  id?: string;
  everyMs?: number;
  once?: boolean;
  message?: string;
  action?: string;
};

export type Session = {
  sessionId: string;
  storageId: string;
  source?: string;
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
  };
};

type EngineStatusResponse = {
  status: EngineStatus;
};

type CronResponse = {
  tasks?: CronTask[];
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

export async function fetchSessions() {
  const data = await fetchJSON<SessionsResponse>("/api/v1/engine/sessions");
  return data.sessions ?? [];
}

export async function fetchSessionEntries(storageId: string) {
  const encoded = encodeURIComponent(storageId);
  const data = await fetchJSON<SessionEntriesResponse>(`/api/v1/engine/sessions/${encoded}`);
  return data.entries ?? [];
}
