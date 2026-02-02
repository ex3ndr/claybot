import type { AgentDescriptor } from "./agentDescriptorTypes.js";

/**
 * Detects heartbeat agents from a descriptor.
 * Expects: descriptor is validated.
 */
export function agentDescriptorIsHeartbeat(
  descriptor?: AgentDescriptor
): descriptor is Extract<AgentDescriptor, { type: "heartbeat" }> {
  return descriptor?.type === "heartbeat";
}
