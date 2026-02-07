import type { AgentDescriptor } from "./agentDescriptorTypes.js";

/**
 * Builds a stable key for descriptors that can be resumed.
 * Expects: descriptor is validated.
 */
export function agentPathForDescriptor(descriptor: AgentDescriptor): string | null {
  switch (descriptor.type) {
    case "cron":
      return `/cron/${descriptor.id}`;
    case "system":
      return `/system/${descriptor.tag}`;
    case "user":
      return `/connectors/${descriptor.connector}/${descriptor.userId}/${descriptor.channelId}`;
    default:
      return null;
  }
}
