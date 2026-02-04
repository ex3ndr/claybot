import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { createId } from "@paralleldrive/cuid2";

import type { ToolDefinition } from "@/types";

const startSchema = Type.Object(
  {
    prompt: Type.String({ minLength: 1 }),
    name: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const sendSchema = Type.Object(
  {
    text: Type.String({ minLength: 1 }),
    agentId: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

type StartBackgroundArgs = Static<typeof startSchema>;
type SendAgentMessageArgs = Static<typeof sendSchema>;

export function buildStartBackgroundAgentTool(): ToolDefinition {
  return {
    tool: {
      name: "start_background_agent",
      description: "Start a background agent to work on a task.",
      parameters: startSchema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as StartBackgroundArgs;
      const prompt = payload.prompt.trim();
      if (!prompt) {
        throw new Error("Background agent prompt is required");
      }
      const agentId = createId();
      const descriptor = {
        type: "subagent" as const,
        id: agentId,
        parentAgentId: toolContext.agent.id,
        name: payload.name ?? "subagent"
      };
      await toolContext.agentSystem.post(
        { descriptor },
        { type: "message", message: { text: prompt }, context: {} }
      );

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: `Background agent started: ${agentId}.`
          }
        ],
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage, files: [] };
    }
  };
}

export function buildSendAgentMessageTool(): ToolDefinition {
  return {
    tool: {
      name: "send_agent_message",
      description:
        "Send a system message to another agent (defaults to the most recent foreground agent).",
      parameters: sendSchema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as SendAgentMessageArgs;
      const descriptor = toolContext.agent.descriptor;
      const origin = toolContext.agent.id;
      const targetAgentId =
        payload.agentId ??
        (descriptor.type === "subagent" ? descriptor.parentAgentId : undefined);
      const resolvedTarget =
        targetAgentId ?? toolContext.agentSystem.agentFor("most-recent-foreground");
      if (!resolvedTarget) {
        throw new Error("No recent foreground agent found.");
      }
      await toolContext.agentSystem.post(
        { agentId: resolvedTarget },
        { type: "system_message", text: payload.text, origin }
      );

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: "System message sent."
          }
        ],
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage, files: [] };
    }
  };
}
