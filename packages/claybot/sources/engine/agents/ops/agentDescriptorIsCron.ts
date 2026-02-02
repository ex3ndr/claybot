import type { AgentDescriptor } from "./agentDescriptorTypes.js";

/**
 * Detects cron agents from a descriptor.
 * Expects: descriptor is validated.
 */
export function agentDescriptorIsCron(
  descriptor?: AgentDescriptor
): descriptor is Extract<AgentDescriptor, { type: "cron" }> {
  return descriptor?.type === "cron";
}
