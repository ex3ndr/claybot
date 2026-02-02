import type { MessageContext } from "@/types";

/**
 * Strips transient fields from routing context.
 * Expects: messageId should not be persisted.
 */
export function agentRoutingSanitize(context: MessageContext): MessageContext {
  const { messageId, ...rest } = context;
  return { ...rest };
}
