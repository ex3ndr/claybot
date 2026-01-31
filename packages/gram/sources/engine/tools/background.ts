import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import type { ToolDefinition } from "./types.js";

const startSchema = Type.Object(
  {
    prompt: Type.String({ minLength: 1 }),
    sessionId: Type.Optional(Type.String({ minLength: 1 })),
    name: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const sendSchema = Type.Object(
  {
    text: Type.String({ minLength: 1 }),
    sessionId: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

type StartBackgroundArgs = Static<typeof startSchema>;
type SendSessionMessageArgs = Static<typeof sendSchema>;

export function buildStartBackgroundAgentTool(): ToolDefinition {
  return {
    tool: {
      name: "start_background_agent",
      description: "Start or continue a background agent session to work on a task.",
      parameters: startSchema
    },
    execute: async (args, toolContext, toolCall) => {
      if (!toolContext.agentRuntime?.startBackgroundAgent) {
        throw new Error("Background agents unavailable");
      }
      const payload = args as StartBackgroundArgs;
      const result = await toolContext.agentRuntime.startBackgroundAgent({
        prompt: payload.prompt,
        sessionId: payload.sessionId,
        name: payload.name,
        parentSessionId: toolContext.session.id
      });

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: `Background agent started: ${result.sessionId}.`
          }
        ],
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage };
    }
  };
}

export function buildSendSessionMessageTool(): ToolDefinition {
  return {
    tool: {
      name: "send_session_message",
      description:
        "Send a system message to another session (defaults to the most recent DM) so a user-facing agent can respond.",
      parameters: sendSchema
    },
    execute: async (args, toolContext, toolCall) => {
      if (!toolContext.agentRuntime?.sendSessionMessage) {
        throw new Error("Session messaging unavailable");
      }
      const payload = args as SendSessionMessageArgs;
      const state = toolContext.session.context.state as {
        agent?: { kind?: string; parentSessionId?: string };
      };
      const origin = state.agent?.kind === "background" ? "background" : "system";
      await toolContext.agentRuntime.sendSessionMessage({
        sessionId: payload.sessionId ?? state.agent?.parentSessionId,
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

      return { toolMessage };
    }
  };
}
