export type SessionDescriptor =
  | { type: "user"; connector: string; userId: string; channelId: string }
  | { type: "cron"; id: string }
  | { type: "heartbeat" }
  | { type: "subagent"; id: string; parentSessionId: string; name: string };

export type SessionFetchStrategy = "most-recent-foreground" | "heartbeat";

export function normalizeSessionDescriptor(value: unknown): SessionDescriptor | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as {
    type?: unknown;
    connector?: unknown;
    userId?: unknown;
    channelId?: unknown;
    id?: unknown;
    parentSessionId?: unknown;
    name?: unknown;
  };
  if (candidate.type === "user") {
    if (
      typeof candidate.connector === "string" &&
      typeof candidate.userId === "string" &&
      typeof candidate.channelId === "string"
    ) {
      return {
        type: "user",
        connector: candidate.connector,
        userId: candidate.userId,
        channelId: candidate.channelId
      };
    }
    return undefined;
  }
  if (candidate.type === "cron") {
    if (typeof candidate.id === "string") {
      return { type: "cron", id: candidate.id };
    }
    return undefined;
  }
  if (candidate.type === "heartbeat") {
    return { type: "heartbeat" };
  }
  if (candidate.type === "subagent") {
    if (
      typeof candidate.id === "string" &&
      typeof candidate.parentSessionId === "string" &&
      typeof candidate.name === "string"
    ) {
      return {
        type: "subagent",
        id: candidate.id,
        parentSessionId: candidate.parentSessionId,
        name: candidate.name
      };
    }
    return undefined;
  }
  return undefined;
}

export function sessionDescriptorMatchesStrategy(
  descriptor: SessionDescriptor,
  strategy: SessionFetchStrategy
): boolean {
  switch (strategy) {
    case "most-recent-foreground":
      return descriptor.type === "user";
    case "heartbeat":
      return descriptor.type === "heartbeat";
    default:
      return false;
  }
}
