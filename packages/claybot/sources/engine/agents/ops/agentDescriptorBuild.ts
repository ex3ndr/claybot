import type { MessageContext } from "@/types";
import type { AgentDescriptor } from "./agentDescriptorTypes.js";

/**
 * Builds an AgentDescriptor from message source and context.
 * Expects: connector sources include user/channel ids.
 */
export function agentDescriptorBuild(
  source: string,
  context: MessageContext,
  agentId: string
): AgentDescriptor {
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
  if (source === "system") {
    return {
      type: "subagent",
      id: agentId,
      parentAgentId: "system",
      name: "system"
    };
  }
  throw new Error("Agent descriptor could not be resolved");
}
