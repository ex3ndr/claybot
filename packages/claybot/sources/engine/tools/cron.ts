import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import { cronExpressionParse as parseCronExpression } from "../cron/cronExpressionParse.js";
import type { CronScheduler } from "../cron/cronScheduler.js";
import type { CronStore } from "../cron/cronStore.js";
import type { ToolDefinition, ToolExecutionContext } from "./types.js";

const addCronSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1 })),
    name: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String({ minLength: 1 })),
    schedule: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    enabled: Type.Optional(Type.Boolean()),
    deleteAfterRun: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

const readCronTaskSchema = Type.Object(
  {
    taskId: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const readCronMemorySchema = Type.Object(
  {
    taskId: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const writeCronMemorySchema = Type.Object(
  {
    taskId: Type.Optional(Type.String({ minLength: 1 })),
    content: Type.String({ minLength: 1 }),
    append: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

const deleteCronTaskSchema = Type.Object(
  {
    taskId: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

type AddCronToolArgs = Static<typeof addCronSchema>;
type CronReadTaskArgs = Static<typeof readCronTaskSchema>;
type CronReadMemoryArgs = Static<typeof readCronMemorySchema>;
type CronWriteMemoryArgs = Static<typeof writeCronMemorySchema>;
type CronDeleteTaskArgs = Static<typeof deleteCronTaskSchema>;

export function buildCronTool(
  cron: CronScheduler | null,
  onTaskAdded?: (task: Awaited<ReturnType<CronScheduler["addTask"]>>) => void
): ToolDefinition {
  return {
    tool: {
      name: "add_cron",
      description:
        "Create a scheduled cron task from a prompt stored in config/cron.",
      parameters: addCronSchema
    },
    execute: async (args, _toolContext, toolCall) => {
      const payload = args as AddCronToolArgs;
      if (!cron) {
        throw new Error("Cron scheduler unavailable");
      }

      if (!parseCronExpression(payload.schedule)) {
        throw new Error(`Invalid cron schedule: ${payload.schedule}`);
      }

      if (payload.id && !isSafeTaskId(payload.id)) {
        throw new Error("Cron task id contains invalid characters.");
      }

      const task = await cron.addTask({
        id: payload.id,
        name: payload.name,
        description: payload.description,
        schedule: payload.schedule,
        prompt: payload.prompt,
        enabled: payload.enabled,
        deleteAfterRun: payload.deleteAfterRun
      });
      onTaskAdded?.(task);

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: `Scheduled cron task ${task.id} (${task.name}) with schedule ${task.schedule}.`
          }
        ],
        details: {
          taskId: task.id,
          name: task.name,
          schedule: task.schedule
        },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage };
    }
  };
}

export function buildCronReadTaskTool(store: CronStore): ToolDefinition {
  return {
    tool: {
      name: "cron_read_task",
      description: "Read a cron task's description and prompt.",
      parameters: readCronTaskSchema
    },
    execute: async (args, context, toolCall) => {
      const payload = args as CronReadTaskArgs;
      const taskId = resolveTaskId(payload.taskId, context);
      const task = await store.loadTask(taskId);
      if (!task) {
        throw new Error(`Cron task not found: ${taskId}`);
      }

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: task.description ?? ""
          },
          {
            type: "text",
            text: task.prompt
          }
        ],
        details: {
          taskId: task.id,
          name: task.name,
          description: task.description ?? null,
          schedule: task.schedule,
          enabled: task.enabled !== false,
          deleteAfterRun: task.deleteAfterRun === true,
          prompt: task.prompt
        },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage };
    }
  };
}

export function buildCronReadMemoryTool(store: CronStore): ToolDefinition {
  return {
    tool: {
      name: "cron_read_memory",
      description: "Read the memory for a cron task.",
      parameters: readCronMemorySchema
    },
    execute: async (args, context, toolCall) => {
      const payload = args as CronReadMemoryArgs;
      const taskId = resolveTaskId(payload.taskId, context);
      const memory = await store.readMemory(taskId);

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: memory
          }
        ],
        details: { taskId },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage };
    }
  };
}

export function buildCronWriteMemoryTool(store: CronStore): ToolDefinition {
  return {
    tool: {
      name: "cron_write_memory",
      description: "Write or append memory for a cron task.",
      parameters: writeCronMemorySchema
    },
    execute: async (args, context, toolCall) => {
      const payload = args as CronWriteMemoryArgs;
      const taskId = resolveTaskId(payload.taskId, context);
      const content = payload.append
        ? appendMemory(await store.readMemory(taskId), payload.content)
        : payload.content;
      await store.writeMemory(taskId, content);

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: `Cron memory updated for task ${taskId}.`
          }
        ],
        details: { taskId, bytes: content.length },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage };
    }
  };
}

export function buildCronDeleteTaskTool(
  cron: CronScheduler | null
): ToolDefinition {
  return {
    tool: {
      name: "cron_delete_task",
      description: "Delete a cron task from disk and scheduler.",
      parameters: deleteCronTaskSchema
    },
    execute: async (args, context, toolCall) => {
      const payload = args as CronDeleteTaskArgs;
      if (!cron) {
        throw new Error("Cron scheduler unavailable");
      }
      const taskId = resolveTaskId(payload.taskId, context);
      const deleted = await cron.deleteTask(taskId);

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: deleted ? `Deleted cron task ${taskId}.` : `Cron task not found: ${taskId}.`
          }
        ],
        details: { taskId, deleted },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage };
    }
  };
}

function resolveTaskId(
  provided: string | undefined,
  context: ToolExecutionContext
): string {
  const fromContext = context.messageContext.cron?.taskId;
  const taskId = provided ?? fromContext;
  if (!taskId) {
    throw new Error("Cron task id is required.");
  }
  if (provided && !isSafeTaskId(taskId)) {
    throw new Error("Cron task id contains invalid characters.");
  }
  return taskId;
}

function isSafeTaskId(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value);
}

function appendMemory(existing: string, next: string): string {
  const trimmedExisting = existing.trim();
  if (!trimmedExisting || trimmedExisting === "No memory") {
    return next;
  }
  return `${trimmedExisting}\n${next}`;
}
