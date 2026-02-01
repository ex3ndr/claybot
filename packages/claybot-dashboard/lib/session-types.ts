import type { Session } from "./engine-client";

export type SessionType =
  | { type: "connection"; connector: string; userId: string; channelId: string }
  | { type: "cron"; id: string; name?: string }
  | { type: "heartbeat"; title?: string }
  | { type: "background_agent"; id: string; parentSessionId: string; name?: string }
  | { type: "background"; id: string };

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
      type: "heartbeat",
      title: context.heartbeat.title
    };
  }
  if (context?.agent?.kind === "background") {
    const parentSessionId = context.agent.parentSessionId;
    if (parentSessionId) {
      return {
        type: "background_agent",
        id: session.sessionId,
        parentSessionId,
        name: context.agent.name
      };
    }
    return { type: "background", id: session.sessionId };
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
  return { type: "background", id: session.sessionId };
}

export function formatSessionTypeLabel(sessionType: SessionType): string {
  switch (sessionType.type) {
    case "connection":
      return "Connection";
    case "cron":
      return "Cron";
    case "heartbeat":
      return "Heartbeat";
    case "background_agent":
      return "Background agent";
    case "background":
      return "Background";
    default:
      return "Session";
  }
}

export function formatSessionTypeObject(sessionType: SessionType): string {
  return JSON.stringify(sessionType);
}
