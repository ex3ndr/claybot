import type { AgentDescriptor } from "./agentDescriptorTypes.js";

/**
 * Builds a short human-friendly label for an agent descriptor.
 * Expects: descriptor is valid.
 */
export function agentDescriptorLabel(descriptor: AgentDescriptor): string {
  if (descriptor.type === "subagent" || descriptor.type === "permanent") {
    return descriptor.name ?? descriptor.type;
  }
  if (descriptor.type === "cron") {
    return descriptor.name ?? "cron task";
  }
  if (descriptor.type === "system") {
    return descriptor.tag;
  }
  return "user";
}
