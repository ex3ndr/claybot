import type { AgentDescriptor } from "./agentDescriptorTypes.js";

/**
 * Builds a stable key for descriptors that can be resumed.
 * Expects: descriptor is validated.
 */
export function agentKeyBuild(descriptor: AgentDescriptor): string | null {
  switch (descriptor.type) {
    case "cron":
      return `cron:${descriptor.id}`;
    case "heartbeat":
      return "heartbeat";
    case "user":
      return `user:${descriptor.connector}:${descriptor.channelId}:${descriptor.userId}`;
    default:
      return null;
  }
}
