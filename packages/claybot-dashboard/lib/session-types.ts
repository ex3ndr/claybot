import type { Session } from "./engine-client";

export type SessionType =
  | { type: "connection"; connector: string; userId: string; channelId: string }
  | { type: "cron"; id: string; name?: string }
  | { type: "heartbeat" }
  | { type: "subagent"; id: string; parentSessionId: string; name: string }
  | { type: "system"; id: string };

const SYSTEM_SOURCES = new Set(["system", "cron", "background"]);

export function buildSessionType(session: Session): SessionType {
  const context = session.context;
  const cronId = context?.cron?.taskUid ?? context?.cron?.taskId;
  if (cronId) {
    return {
      type: "cron",
      id: cronId,
      name: context?.cron?.taskName
    };
  }
  if (context?.heartbeat) {
    return {
      type: "heartbeat"
    };
  }
  if (context?.agent?.kind === "background") {
    const parentSessionId = context.agent.parentSessionId;
    const name = context.agent.name;
    if (parentSessionId && name) {
      return {
        type: "subagent",
        id: session.sessionId,
        parentSessionId,
        name
      };
    }
    return { type: "system", id: session.sessionId };
  }
  const source = session.source ?? "";
  if (source && !SYSTEM_SOURCES.has(source) && context?.userId && context?.channelId) {
    return {
      type: "connection",
      connector: source,
      userId: context.userId,
      channelId: context.channelId
    };
  }
  return { type: "system", id: session.sessionId };
}

export function formatSessionTypeLabel(sessionType: SessionType): string {
  switch (sessionType.type) {
    case "connection":
      return "Connection";
    case "cron":
      return "Cron";
    case "heartbeat":
      return "Heartbeat";
    case "subagent":
      return "Subagent";
    case "system":
      return "System";
    default:
      return "Session";
  }
}

export function formatSessionTypeObject(sessionType: SessionType): string {
  return JSON.stringify(sessionType);
}
