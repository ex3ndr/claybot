import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import type { MemoryEngine } from "../memory/engine.js";
import type { ToolDefinition } from "./types.js";

const memorySchema = Type.Object(
  {
    query: Type.String({ minLength: 1 }),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 }))
  },
  { additionalProperties: false }
);

type MemoryArgs = Static<typeof memorySchema>;

export function buildMemoryTool(memory: MemoryEngine | null): ToolDefinition {
  return {
    tool: {
      name: "memory_search",
      description: "Search memory entries by keyword.",
      parameters: memorySchema
    },
    execute: async (args, _toolContext, toolCall) => {
      if (!memory) {
        throw new Error("Memory engine unavailable");
      }
      const payload = args as MemoryArgs;
      const results = await memory.query(payload.query, payload.limit ?? 10);
      const text = results.length === 0
        ? "No memory matches."
        : results
            .map((entry) => {
              const line = entry.text ?? "";
              return `[${entry.sessionId}] ${line}`.trim();
            })
            .join("\n");

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text }],
        details: {
          count: results.length,
          entries: results
        },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage };
    }
  };
}
