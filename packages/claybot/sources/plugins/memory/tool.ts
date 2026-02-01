import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import type { ToolDefinition } from "@/types";
import type { MemoryStore } from "./store.js";

const createEntitySchema = Type.Object(
  {
    entity: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 60 }),
    description: Type.String({ minLength: 1, maxLength: 160 })
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

const listEntitiesSchema = Type.Object(
  {
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200 }))
  },
  { additionalProperties: false }
);

type CreateEntityArgs = Static<typeof createEntitySchema>;
type UpsertRecordArgs = Static<typeof upsertRecordSchema>;
type ListEntitiesArgs = Static<typeof listEntitiesSchema>;

export function buildMemoryCreateEntityTool(store: MemoryStore): ToolDefinition {
  return {
    tool: {
      name: "memory_create_entity",
      description:
        "Create or update a memory entity type (lowercase a-z only, no underscores).",
      parameters: createEntitySchema
    },
    execute: async (args, _toolContext, toolCall) => {
      const payload = args as CreateEntityArgs;
      const result = await store.createEntity(
        payload.entity,
        payload.name,
        payload.description
      );

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: result.created
              ? `Created memory entity ${result.entity}.`
              : `Memory entity ${result.entity} updated.`
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

export function buildMemoryListEntitiesTool(store: MemoryStore): ToolDefinition {
  return {
    tool: {
      name: "memory_list_entities",
      description:
        "List memory entities with their short name and description.",
      parameters: listEntitiesSchema
    },
    execute: async (args, _toolContext, toolCall) => {
      const payload = args as ListEntitiesArgs;
      const entries = await store.listEntitySummaries(payload.limit);
      const text = entries.length === 0
        ? "No memory entities."
        : entries
            .map((entry) => `- ${entry.entity}: ${entry.name} — ${entry.description}`)
            .join("\n");

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text }],
        details: {
          count: entries.length,
          entities: entries
        },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage };
    }
  };
}
