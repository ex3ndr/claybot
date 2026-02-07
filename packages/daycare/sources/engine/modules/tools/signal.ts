import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { Type, type Static } from "@sinclair/typebox";

import type { ToolDefinition } from "@/types";
import type { Signals } from "../../signals/signals.js";

const sourceSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("system")
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("agent"),
      id: Type.String({ minLength: 1 })
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("webhook"),
      id: Type.Optional(Type.String({ minLength: 1 }))
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("process"),
      id: Type.Optional(Type.String({ minLength: 1 }))
    },
    { additionalProperties: false }
  )
]);

const schema = Type.Object(
  {
    type: Type.String({ minLength: 1 }),
    source: Type.Optional(sourceSchema),
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
        "Broadcast a signal event. Any agent subscribed to a matching pattern receives it. Use colon-separated type segments (e.g. `build:project-x:done`). Signals are fire-and-forget — you don't need to know who listens.",
      parameters: schema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as GenerateSignalArgs;
      const source = payload.source ?? { type: "agent", id: toolContext.agent.id };
      const signal = await signals.generate({
        type: payload.type,
        source,
        data: payload.data
      });

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: `Signal generated: ${signal.id} (${signal.type}, source=${signalSourceLabel(signal.source)}).`
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

function signalSourceLabel(source: { type: string; id?: string }): string {
  return source.id ? `${source.type}:${source.id}` : source.type;
}
