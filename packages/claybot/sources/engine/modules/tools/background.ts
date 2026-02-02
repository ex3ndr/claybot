import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import type { ToolDefinition } from "@/types";

const startSchema = Type.Object(
  {
    prompt: Type.String({ minLength: 1 }),
    agentId: Type.Optional(Type.String({ minLength: 1 })),
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
      description: "Start or continue a background agent to work on a task.",
      parameters: startSchema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as StartBackgroundArgs;
      const result = await toolContext.agentRuntime.startBackgroundAgent({
        prompt: payload.prompt,
        agentId: payload.agentId,
        name: payload.name,
        parentAgentId: toolContext.agent.id
      });

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: `Background agent started: ${result.agentId}.`
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
        "Send a system message to another agent (defaults to the most recent foreground agent) so a user-facing agent can respond.",
      parameters: sendSchema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as SendAgentMessageArgs;
      const stateAgent = toolContext.agent.state.agent;
      const origin = stateAgent?.kind === "background" ? "background" : "system";
      const targetAgentId = payload.agentId ?? stateAgent?.parentAgentId ?? undefined;
      await toolContext.agentRuntime.sendAgentMessage({
        agentId: targetAgentId,
        text: payload.text,
        origin
      });

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
