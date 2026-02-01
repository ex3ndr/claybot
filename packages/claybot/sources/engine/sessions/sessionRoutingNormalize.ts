import type { MessageContext } from "@/types";
import type { SessionState } from "./sessionStateTypes.js";

export function sessionRoutingNormalize(
  value: unknown
): SessionState["routing"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as { source?: unknown; context?: unknown };
  if (typeof candidate.source !== "string") {
    return undefined;
  }
  if (!candidate.context || typeof candidate.context !== "object") {
    return undefined;
  }
  const context = candidate.context as MessageContext;
  if (!context.channelId || !context.userId) {
    return undefined;
  }
  return { source: candidate.source, context };
}
