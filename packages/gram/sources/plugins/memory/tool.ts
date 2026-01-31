import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import type { ToolDefinition } from "../../engine/tools/types.js";
import type { MemoryStore } from "./store.js";

const createEntitySchema = Type.Object(
  {
    entity: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const upsertRecordSchema = Type.Object(
  {
    entity: Type.String({ minLength: 1 }),
    record: Type.String({ minLength: 1 }),
    content: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

type CreateEntityArgs = Static<typeof createEntitySchema>;
type UpsertRecordArgs = Static<typeof upsertRecordSchema>;

export function buildMemoryCreateEntityTool(store: MemoryStore): ToolDefinition {
  return {
    tool: {
      name: "memory_create_entity",
      description:
        "Create a new memory entity type (lowercase a-z only, no underscores).",
      parameters: createEntitySchema
    },
    execute: async (args, _toolContext, toolCall) => {
      const payload = args as CreateEntityArgs;
      const result = await store.createEntity(payload.entity);

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: result.created
              ? `Created memory entity ${result.entity}.`
              : `Memory entity ${result.entity} already exists.`
          }
        ],
        details: {
          entity: result.entity,
          created: result.created,
          path: result.path
        },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage };
    }
  };
}

export function buildMemoryUpsertRecordTool(store: MemoryStore): ToolDefinition {
  return {
    tool: {
      name: "memory_upsert_record",
      description:
        "Add or update a memory record as markdown under an entity.",
      parameters: upsertRecordSchema
    },
    execute: async (args, _toolContext, toolCall) => {
      const payload = args as UpsertRecordArgs;
      const result = await store.upsertRecord(
        payload.entity,
        payload.record,
        payload.content
      );

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: result.created
              ? `Added record ${result.record} to ${result.entity}.`
              : `Updated record ${result.record} in ${result.entity}.`
          }
        ],
        details: {
          entity: result.entity,
          record: result.record,
          created: result.created,
          path: result.path
        },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage };
    }
  };
}
