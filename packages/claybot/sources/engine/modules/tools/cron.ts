import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import { taskIdIsSafe } from "../../../utils/taskIdIsSafe.js";
import { cronExpressionParse as parseCronExpression } from "../../cron/ops/cronExpressionParse.js";
import type { Crons } from "../../cron/crons.js";
import { execGateNormalize } from "../../scheduling/execGateNormalize.js";
import type { ToolDefinition, ToolExecutionContext } from "@/types";

const envSchema = Type.Record(
  Type.String({ minLength: 1 }),
  Type.Union([Type.String(), Type.Number(), Type.Boolean()])
);

const addCronSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1 })),
    name: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String({ minLength: 1 })),
    schedule: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    agentId: Type.Optional(Type.String({ minLength: 1 })),
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

export function buildCronTool(crons: Crons): ToolDefinition {
  return {
    tool: {
      name: "add_cron",
      description:
        "Create a scheduled cron task from a prompt stored in config/cron (optional agentId + gate).",
      parameters: addCronSchema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as AddCronToolArgs;

      if (!parseCronExpression(payload.schedule)) {
        throw new Error(`Invalid cron schedule: ${payload.schedule}`);
      }

      if (payload.id && !taskIdIsSafe(payload.id)) {
        throw new Error("Cron task id contains invalid characters.");
      }

      const gate = execGateNormalize(payload.gate);
      const task = await crons.addTask({
        id: payload.id,
        name: payload.name,
        description: payload.description,
        schedule: payload.schedule,
        prompt: payload.prompt,
        agentId: payload.agentId,
        gate,
        enabled: payload.enabled,
        deleteAfterRun: payload.deleteAfterRun
      });

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
          schedule: task.schedule,
          agentId: task.agentId ?? null,
          gate: task.gate ?? null
        },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage, files: [] };
    }
  };
}

export function buildCronReadTaskTool(crons: Crons): ToolDefinition {
  return {
    tool: {
      name: "cron_read_task",
      description: "Read a cron task's description and prompt.",
      parameters: readCronTaskSchema
    },
    execute: async (args, context, toolCall) => {
      const payload = args as CronReadTaskArgs;
      const taskId = await resolveTaskId(payload.taskId, context);
      const task = await crons.loadTask(taskId);
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
          agentId: task.agentId ?? null,
          gate: task.gate ?? null,
          enabled: task.enabled !== false,
          deleteAfterRun: task.deleteAfterRun === true,
          prompt: task.prompt
        },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage, files: [] };
    }
  };
}

export function buildCronReadMemoryTool(crons: Crons): ToolDefinition {
  return {
    tool: {
      name: "cron_read_memory",
      description: "Read the memory for a cron task.",
      parameters: readCronMemorySchema
    },
    execute: async (args, context, toolCall) => {
      const payload = args as CronReadMemoryArgs;
      const taskId = await resolveTaskId(payload.taskId, context);
      const memory = await crons.readMemory(taskId);

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

      return { toolMessage, files: [] };
    }
  };
}

export function buildCronWriteMemoryTool(crons: Crons): ToolDefinition {
  return {
    tool: {
      name: "cron_write_memory",
      description: "Write or append memory for a cron task.",
      parameters: writeCronMemorySchema
    },
    execute: async (args, context, toolCall) => {
      const payload = args as CronWriteMemoryArgs;
      const taskId = await resolveTaskId(payload.taskId, context);
      const content = payload.append
        ? appendMemory(await crons.readMemory(taskId), payload.content)
        : payload.content;
      await crons.writeMemory(taskId, content);

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

      return { toolMessage, files: [] };
    }
  };
}

export function buildCronDeleteTaskTool(crons: Crons): ToolDefinition {
  return {
    tool: {
      name: "cron_delete_task",
      description: "Delete a cron task from disk and scheduler.",
      parameters: deleteCronTaskSchema
    },
    execute: async (args, context, toolCall) => {
      const payload = args as CronDeleteTaskArgs;
      const taskId = await resolveTaskId(payload.taskId, context);
      const deleted = await crons.deleteTask(taskId);

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

      return { toolMessage, files: [] };
    }
  };
}

async function resolveTaskId(
  provided: string | undefined,
  context: ToolExecutionContext
): Promise<string> {
  const taskId = provided ?? await context.agent.resolveCronTaskId();
  if (!taskId) {
    throw new Error("Cron task id is required.");
  }
  if (provided && !taskIdIsSafe(taskId)) {
    throw new Error("Cron task id contains invalid characters.");
  }
  return taskId;
}

function appendMemory(existing: string, next: string): string {
  const trimmedExisting = existing.trim();
  if (!trimmedExisting || trimmedExisting === "No memory") {
    return next;
  }
  return `${trimmedExisting}\n${next}`;
}
