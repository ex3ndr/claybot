import type { AgentDescriptor } from "./agentDescriptorTypes.js";

/**
 * Builds an AgentDescriptor from message source and context.
 * Expects: source === "system" for synthetic agents.
 */
export function agentDescriptorBuild(
  source: string,
  _context: unknown,
  agentId: string
): AgentDescriptor {
  if (source === "system") {
    return {
      type: "subagent",
      id: agentId,
      parentAgentId: "system",
      name: "system"
    };
  }
  throw new Error("Agent descriptor requires explicit descriptor data for non-system sources");
}
