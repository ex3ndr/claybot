import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";

import type { ToolDefinition } from "@/types";
import type { Signals } from "../../signals/signals.js";

const schema = Type.Object(
  {
    type: Type.String({ minLength: 1 }),
    source: Type.Optional(
      Type.Union([
        Type.Literal("webhook"),
        Type.Literal("agent"),
        Type.Literal("process")
      ])
    ),
    data: Type.Optional(Type.Unknown())
  },
  { additionalProperties: false }
);

type GenerateSignalArgs = Static<typeof schema>;

export function buildSignalGenerateTool(signals: Signals): ToolDefinition {
  return {
    tool: {
      name: "generate_signal",
      description:
        "Generate a signal with a type id and optional payload for runtime automation.",
      parameters: schema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as GenerateSignalArgs;
      const source = payload.source ?? "agent";
      const signal = signals.generate({
        type: payload.type,
        source,
        data: payload.data,
        agentId: source === "agent" ? toolContext.agent.id : undefined
      });

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: `Signal generated: ${signal.id} (${signal.type}, source=${signal.source}).`
          }
        ],
        details: { signal },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage, files: [] };
    }
  };
}
