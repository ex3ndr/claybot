import type { AgentDescriptor } from "./agentDescriptorTypes.js";

/**
 * Detects heartbeat agents from a descriptor.
 * Expects: descriptor is validated.
 */
export function agentDescriptorIsHeartbeat(
  descriptor?: AgentDescriptor
): descriptor is Extract<AgentDescriptor, { type: "system"; tag: "heartbeat" }> {
  return descriptor?.type === "system" && descriptor.tag === "heartbeat";
}
