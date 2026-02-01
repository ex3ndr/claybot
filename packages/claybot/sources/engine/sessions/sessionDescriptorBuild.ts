import type { MessageContext } from "@/types";
import type { SessionDescriptor } from "./descriptor.js";
import { cuid2Is } from "../../utils/cuid2Is.js";

export function sessionDescriptorBuild(
  source: string,
  context: MessageContext,
  sessionId: string
): SessionDescriptor {
  if (context.cron) {
    const taskUid = cuid2Is(context.cron.taskUid ?? null) ? context.cron.taskUid! : null;
    if (taskUid) {
      return { type: "cron", id: taskUid };
    }
  }
  if (context.heartbeat) {
    return { type: "heartbeat" };
  }
  if (
    source &&
    source !== "system" &&
    source !== "cron" &&
    source !== "background" &&
    context.userId &&
    context.channelId
  ) {
    return {
      type: "user",
      connector: source,
      userId: context.userId,
      channelId: context.channelId
    };
  }
  if (context.agent?.kind === "background") {
    if (!context.agent.parentSessionId || !context.agent.name) {
      throw new Error("Subagent context requires parentSessionId and name");
    }
    return {
      type: "subagent",
      id: sessionId,
      parentSessionId: context.agent.parentSessionId,
      name: context.agent.name
    };
  }
  if (source === "system") {
    return {
      type: "subagent",
      id: sessionId,
      parentSessionId: "system",
      name: "system"
    };
  }
  throw new Error("Session descriptor could not be resolved");
}
