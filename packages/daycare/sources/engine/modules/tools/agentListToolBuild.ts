import { Type } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import type { ToolDefinition } from "@/types";
import { agentDescriptorLabel } from "../../agents/ops/agentDescriptorLabel.js";
import { agentList } from "../../agents/ops/agentList.js";

const schema = Type.Object({}, { additionalProperties: false });

/**
 * Builds the list_agents tool for enumerating persisted sessions/agents.
 * Expects: agent descriptors + state are available on disk.
 */
export function agentListToolBuild(): ToolDefinition {
  return {
    tool: {
      name: "list_agents",
      description: "List all persisted agents with ids, types, names, and lifecycle state.",
      parameters: schema
    },
    execute: async (_args, toolContext, toolCall) => {
      const entries = await agentList(toolContext.agentSystem.config.current);
      const agents = entries
        .map((entry) => {
          const descriptor = entry.descriptor;
          return {
            agentId: entry.agentId,
            type: descriptor.type,
            label: agentDescriptorLabel(descriptor),
            name:
              descriptor.type === "subagent" || descriptor.type === "permanent"
                ? descriptor.name
                : descriptor.type === "system"
                  ? descriptor.tag
                : null,
            parentAgentId: descriptor.type === "subagent" ? descriptor.parentAgentId : null,
            connector: descriptor.type === "user" ? descriptor.connector : null,
            userId: descriptor.type === "user" ? descriptor.userId : null,
            channelId: descriptor.type === "user" ? descriptor.channelId : null,
            lifecycle: entry.lifecycle,
            updatedAt: entry.updatedAt
          };
        })
        .sort((left, right) => right.updatedAt - left.updatedAt);

      const text = agents.length === 0
        ? "No agents found."
        : [
            `Found ${agents.length} agent(s):`,
            ...agents.map((agent) => {
              const namePart = agent.name ? ` name=${agent.name}` : "";
              const parentPart = agent.parentAgentId
                ? ` parentAgentId=${agent.parentAgentId}`
                : "";
              const userPart = agent.connector
                ? ` connector=${agent.connector} channelId=${agent.channelId} userId=${agent.userId}`
                : "";
              return `${agent.agentId} type=${agent.type}${namePart}${parentPart}${userPart} lifecycle=${agent.lifecycle}`;
            })
          ].join("\n");

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text }],
        details: {
          count: agents.length,
          agents
        },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage, files: [] };
    }
  };
}
