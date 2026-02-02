import type { Logger } from "pino";

import type { MessageContext } from "@/types";

/**
 * Resolves an agent key for connector routing and agent mapping.
 * Expects: context has user/channel ids for user agents; returns null when unavailable.
 */
export function agentKeyResolve(
  source: string,
  context: MessageContext,
  logger: Logger
): string | null {
  if (!context.userId || !context.channelId) {
    logger.warn(
      { source, channelId: context.channelId, userId: context.userId },
      "Missing user or channel id for agent mapping"
    );
    return null;
  }
  if (!source || source === "system" || source === "cron" || source === "background") {
    return null;
  }
  return `user:${source}:${context.channelId}:${context.userId}`;
}
