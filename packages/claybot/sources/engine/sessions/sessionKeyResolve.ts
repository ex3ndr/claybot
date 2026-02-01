import type { Logger } from "pino";

import type { MessageContext } from "@/types";
import { cuid2Is } from "../../utils/cuid2Is.js";

/**
 * Resolves a session key for connector routing and session mapping.
 * Expects: context has user/channel ids for user sessions; returns null when unavailable.
 */
export function sessionKeyResolve(
  source: string,
  context: MessageContext,
  logger: Logger
): string | null {
  if (context.cron) {
    if (cuid2Is(context.cron.taskUid)) {
      return `cron:${context.cron.taskUid}`;
    }
    return null;
  }
  if (context.heartbeat) {
    return "heartbeat";
  }
  if (!context.userId || !context.channelId) {
    logger.warn(
      { source, channelId: context.channelId, userId: context.userId },
      "Missing user or channel id for session mapping"
    );
    return null;
  }
  if (!source || source === "system" || source === "cron" || source === "background") {
    return null;
  }
  return `user:${source}:${context.channelId}:${context.userId}`;
}
