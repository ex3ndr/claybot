import type { AgentSummary } from "./engine-client";

export type AgentType =
  | { type: "connection"; connector: string; userId: string; channelId: string }
  | { type: "cron"; id: string }
  | { type: "heartbeat" }
  | { type: "subagent"; id: string; parentAgentId: string; name: string }
  | { type: "system"; id: string };

export function buildAgentType(agent: AgentSummary): AgentType {
  const descriptor = agent.descriptor;
  switch (descriptor.type) {
    case "user":
      return {
        type: "connection",
        connector: descriptor.connector,
        userId: descriptor.userId,
        channelId: descriptor.channelId
      };
    case "cron":
      return { type: "cron", id: descriptor.id };
    case "heartbeat":
      return { type: "heartbeat" };
    case "subagent":
      return {
        type: "subagent",
        id: descriptor.id,
        parentAgentId: descriptor.parentAgentId,
        name: descriptor.name
      };
    default:
      return { type: "system", id: agent.agentId };
  }
}

export function formatAgentTypeLabel(agentType: AgentType): string {
  switch (agentType.type) {
    case "connection":
      return "Connection";
    case "cron":
      return "Cron";
    case "heartbeat":
      return "Heartbeat";
    case "subagent":
      return "Subagent";
    case "system":
      return "System";
    default:
      return "Agent";
  }
}

export function formatAgentTypeObject(agentType: AgentType): string {
  return JSON.stringify(agentType);
}
