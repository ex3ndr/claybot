import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";

import type { ToolDefinition } from "@/types";
import type { Signals } from "../../signals/signals.js";

const schema = Type.Object(
  {
    pattern: Type.String({ minLength: 1 }),
    agentId: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

type UnsubscribeSignalArgs = Static<typeof schema>;

export function buildSignalUnsubscribeTool(signals: Signals): ToolDefinition {
  return {
    tool: {
      name: "signal_unsubscribe",
      description:
        "Remove a signal subscription. The pattern must exactly match the one used in `signal_subscribe`. Pass `agentId` to unsubscribe another agent.",
      parameters: schema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as UnsubscribeSignalArgs;
      const targetAgentId = payload.agentId?.trim() ?? toolContext.agent.id;
      const exists = await toolContext.agentSystem.agentExists(targetAgentId);
      if (!exists) {
        throw new Error(`Agent not found: ${targetAgentId}`);
      }

      const removed = signals.unsubscribe({
        agentId: targetAgentId,
        pattern: payload.pattern
      });

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: removed
              ? `Signal subscription removed for ${targetAgentId}: ${payload.pattern}.`
              : `No signal subscription found for ${targetAgentId}: ${payload.pattern}.`
          }
        ],
        details: { removed, agentId: targetAgentId, pattern: payload.pattern },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage, files: [] };
    }
  };
}
