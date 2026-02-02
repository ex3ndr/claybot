import type { AgentDescriptor } from "./agentDescriptorTypes.js";

/**
 * Resolves connector targeting for user agents.
 * Expects: descriptor is validated.
 */
export function agentDescriptorTargetResolve(
  descriptor: AgentDescriptor
): { connector: string; targetId: string } | null {
  if (descriptor.type !== "user") {
    return null;
  }
  return { connector: descriptor.connector, targetId: descriptor.channelId };
}
