import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import type { CronScheduler } from "../../modules/runtime/cron.js";
import type { ToolDefinition } from "./types.js";

const addCronSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1 })),
    everyMs: Type.Number({ minimum: 1 }),
    message: Type.String({ minLength: 1 }),
    runOnStart: Type.Optional(Type.Boolean()),
    once: Type.Optional(Type.Boolean()),
    channelId: Type.Optional(Type.String({ minLength: 1 })),
    sessionId: Type.Optional(Type.String({ minLength: 1 })),
    userId: Type.Optional(
      Type.Union([Type.String({ minLength: 1 }), Type.Null()])
    ),
    source: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

type AddCronToolArgs = Static<typeof addCronSchema>;

export function buildCronTool(
  cron: CronScheduler | null,
  onTaskAdded?: (task: ReturnType<CronScheduler["addTask"]>) => void
): ToolDefinition {
  return {
    tool: {
      name: "add_cron",
      description:
        "Schedule a cron task that sends a message to the current chat. Defaults to a one-shot timer unless once=false.",
      parameters: addCronSchema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as AddCronToolArgs;
      if (!cron) {
        throw new Error("Cron scheduler unavailable");
      }

      if (!toolContext.connectorRegistry) {
        throw new Error("Connector registry unavailable");
      }

      const source = payload.source ?? toolContext.source;
      if (!toolContext.connectorRegistry.has(source)) {
        throw new Error(`Connector not loaded: ${source}`);
      }

      const task = cron.addTask({
        id: payload.id,
        everyMs: payload.everyMs,
        message: payload.message,
        runOnStart: payload.runOnStart,
        once: payload.once ?? true,
        channelId: payload.channelId ?? toolContext.messageContext.channelId,
        sessionId: payload.sessionId ?? toolContext.messageContext.sessionId,
        userId: payload.userId ?? toolContext.messageContext.userId,
        action: "send-message",
        source
      });
      onTaskAdded?.(task);

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: `Scheduled cron task ${task.id} every ${task.everyMs}ms${task.once ? " (once)" : ""}.`
          }
        ],
        details: { taskId: task.id },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage };
    }
  };
}
