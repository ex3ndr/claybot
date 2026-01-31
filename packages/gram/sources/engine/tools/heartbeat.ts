import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import type { ToolDefinition } from "./types.js";

const runSchema = Type.Object(
  {
    ids: Type.Optional(Type.Array(Type.String({ minLength: 1 })))
  },
  { additionalProperties: false }
);

type RunHeartbeatArgs = Static<typeof runSchema>;

export function buildRunHeartbeatTool(): ToolDefinition {
  return {
    tool: {
      name: "run_heartbeat",
      description: "Run heartbeat tasks immediately instead of waiting for the next interval.",
      parameters: runSchema
    },
    execute: async (args, toolContext, toolCall) => {
      if (!toolContext.agentRuntime?.runHeartbeatNow) {
        throw new Error("Heartbeat unavailable");
      }
      const payload = args as RunHeartbeatArgs;
      const result = await toolContext.agentRuntime.runHeartbeatNow({ ids: payload.ids });

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: result.ran > 0
              ? `Heartbeat ran ${result.ran} task(s): ${result.taskIds.join(", ")}.`
              : "No heartbeat tasks ran."
          }
        ],
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage };
    }
  };
}
