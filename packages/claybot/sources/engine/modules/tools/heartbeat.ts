import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import { execGateNormalize } from "../../scheduling/execGateNormalize.js";
import type { ToolDefinition } from "@/types";

const envSchema = Type.Record(
  Type.String({ minLength: 1 }),
  Type.Union([Type.String(), Type.Number(), Type.Boolean()])
);

const runSchema = Type.Object(
  {
    ids: Type.Optional(Type.Array(Type.String({ minLength: 1 })))
  },
  { additionalProperties: false }
);

const addSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1 })),
    title: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    gate: Type.Optional(Type.Object(
      {
        command: Type.String({ minLength: 1 }),
        cwd: Type.Optional(Type.String({ minLength: 1 })),
        timeoutMs: Type.Optional(Type.Number({ minimum: 100, maximum: 300_000 })),
        env: Type.Optional(envSchema),
        permissions: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
        allowedDomains: Type.Optional(
          Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })
        )
      },
      { additionalProperties: false }
    )),
    overwrite: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

const listSchema = Type.Object({}, { additionalProperties: false });

const removeSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

type RunHeartbeatArgs = Static<typeof runSchema>;
type AddHeartbeatArgs = Static<typeof addSchema>;
type RemoveHeartbeatArgs = Static<typeof removeSchema>;

export function buildHeartbeatRunTool(): ToolDefinition {
  return {
    tool: {
      name: "heartbeat_run",
      description: "Run heartbeat tasks immediately as a single batch instead of waiting for the next interval.",
      parameters: runSchema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as RunHeartbeatArgs;
      const result = await toolContext.heartbeats.runNow({ ids: payload.ids });

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

      return { toolMessage, files: [] };
    }
  };
}

export function buildHeartbeatAddTool(): ToolDefinition {
  return {
    tool: {
      name: "heartbeat_add",
      description: "Create or update a heartbeat prompt stored in config/heartbeat (optional gate).",
      parameters: addSchema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as AddHeartbeatArgs;

      const gate = execGateNormalize(payload.gate);
      const result = await toolContext.heartbeats.addTask({
        id: payload.id,
        title: payload.title,
        prompt: payload.prompt,
        gate,
        overwrite: payload.overwrite
      });

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: `Heartbeat saved: ${result.id} (${result.title}).`
          }
        ],
        details: {
          id: result.id,
          title: result.title,
          filePath: result.filePath,
          gate: result.gate ?? null
        },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage, files: [] };
    }
  };
}

export function buildHeartbeatListTool(): ToolDefinition {
  return {
    tool: {
      name: "heartbeat_list",
      description: "List available heartbeat tasks.",
      parameters: listSchema
    },
    execute: async (_args, toolContext, toolCall) => {
      const tasks = await toolContext.heartbeats.listTasks();
      const text = tasks.length > 0
        ? tasks
          .map((task) =>
            `${task.id}: ${task.title}${
              task.lastRunAt ? ` (last run ${task.lastRunAt})` : ""
            }`
          )
          .join("\n")
        : "No heartbeat tasks found.";

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text }],
        details: {
          tasks: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            prompt: task.prompt,
            filePath: task.filePath,
            gate: task.gate ?? null,
            lastRunAt: task.lastRunAt ?? null
          }))
        },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage, files: [] };
    }
  };
}

export function buildHeartbeatRemoveTool(): ToolDefinition {
  return {
    tool: {
      name: "heartbeat_remove",
      description: "Delete a heartbeat task.",
      parameters: removeSchema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as RemoveHeartbeatArgs;
      const removed = await toolContext.heartbeats.removeTask(payload.id);

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: removed
              ? `Removed heartbeat ${payload.id}.`
              : `Heartbeat not found: ${payload.id}.`
          }
        ],
        details: { id: payload.id, removed },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage, files: [] };
    }
  };
}
