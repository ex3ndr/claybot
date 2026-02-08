import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import type { ToolDefinition } from "@/types";
import type { SessionPermissions } from "@/types";
import type { Processes } from "../../engine/processes/processes.js";
import { permissionTagsApply } from "../../engine/permissions/permissionTagsApply.js";
import { permissionTagsNormalize } from "../../engine/permissions/permissionTagsNormalize.js";
import { permissionTagsValidate } from "../../engine/permissions/permissionTagsValidate.js";

const envSchema = Type.Record(
  Type.String({ minLength: 1 }),
  Type.Union([Type.String(), Type.Number(), Type.Boolean()])
);

const packageManagerSchema = Type.Union([
  Type.Literal("dart"),
  Type.Literal("dotnet"),
  Type.Literal("go"),
  Type.Literal("java"),
  Type.Literal("node"),
  Type.Literal("php"),
  Type.Literal("python"),
  Type.Literal("ruby"),
  Type.Literal("rust")
]);

const signalSchema = Type.Union([
  Type.Literal("SIGTERM"),
  Type.Literal("SIGINT"),
  Type.Literal("SIGHUP"),
  Type.Literal("SIGKILL")
]);

const processStartSchema = Type.Object(
  {
    command: Type.String({ minLength: 1 }),
    name: Type.Optional(Type.String({ minLength: 1 })),
    cwd: Type.Optional(Type.String({ minLength: 1 })),
    home: Type.Optional(Type.String({ minLength: 1 })),
    env: Type.Optional(envSchema),
    permissions: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
    keepAlive: Type.Optional(Type.Boolean()),
    packageManagers: Type.Optional(Type.Array(packageManagerSchema, { minItems: 1 })),
    allowedDomains: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }))
  },
  { additionalProperties: false }
);

const processStopSchema = Type.Object(
  {
    processId: Type.String({ minLength: 1 }),
    signal: Type.Optional(signalSchema)
  },
  { additionalProperties: false }
);

const processStopAllSchema = Type.Object(
  {
    signal: Type.Optional(signalSchema)
  },
  { additionalProperties: false }
);

const processGetSchema = Type.Object(
  {
    processId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

type ProcessStartArgs = Static<typeof processStartSchema>;
type ProcessStopArgs = Static<typeof processStopSchema>;
type ProcessStopAllArgs = Static<typeof processStopAllSchema>;
type ProcessGetArgs = Static<typeof processGetSchema>;

export function buildProcessStartTool(processes: Processes): ToolDefinition {
  return {
    tool: {
      name: "process_start",
      description:
        "Start a durable sandboxed process. The process survives engine restarts and can optionally auto-restart when keepAlive is true. By default it starts with zero permissions unless explicit permission tags are provided.",
      parameters: processStartSchema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as ProcessStartArgs;
      const permissions = await resolveProcessPermissions(
        toolContext.permissions,
        payload.permissions
      );
      const processInfo = await processes.create(payload, permissions);
      const text = [
        `Process started: ${processInfo.id}`,
        `name: ${processInfo.name}`,
        `pid: ${processInfo.pid ?? "unknown"}`,
        `keepAlive: ${processInfo.keepAlive}`,
        `status: ${processInfo.status}`,
        `logPath: ${processInfo.logPath}`
      ].join("\n");
      return {
        toolMessage: buildToolMessage(toolCall, text, false, {
          processId: processInfo.id,
          pid: processInfo.pid,
          keepAlive: processInfo.keepAlive,
          status: processInfo.status
        }),
        files: []
      };
    }
  };
}

export function buildProcessListTool(processes: Processes): ToolDefinition {
  return {
    tool: {
      name: "process_list",
      description: "List durable managed processes and their current state.",
      parameters: Type.Object({}, { additionalProperties: false })
    },
    execute: async (_args, _toolContext, toolCall) => {
      const items = await processes.list();
      const text =
        items.length === 0
          ? "No managed processes."
          : JSON.stringify(
              items.map((item) => ({
                id: item.id,
                name: item.name,
                pid: item.pid,
                status: item.status,
                keepAlive: item.keepAlive,
                restartCount: item.restartCount,
                logPath: item.logPath,
                command: item.command
              })),
              null,
              2
            );
      return {
        toolMessage: buildToolMessage(toolCall, text, false, { count: items.length }),
        files: []
      };
    }
  };
}

export function buildProcessGetTool(processes: Processes): ToolDefinition {
  return {
    tool: {
      name: "process_get",
      description: "Get one durable managed process by id.",
      parameters: processGetSchema
    },
    execute: async (args, _toolContext, toolCall) => {
      const payload = args as ProcessGetArgs;
      const item = await processes.get(payload.processId);
      const text = JSON.stringify(
        {
          id: item.id,
          name: item.name,
          pid: item.pid,
          status: item.status,
          keepAlive: item.keepAlive,
          restartCount: item.restartCount,
          logPath: item.logPath,
          command: item.command
        },
        null,
        2
      );
      return {
        toolMessage: buildToolMessage(toolCall, text, false, {
          processId: item.id,
          pid: item.pid,
          status: item.status,
          path: item.logPath
        }),
        files: []
      };
    }
  };
}

export function buildProcessStopTool(processes: Processes): ToolDefinition {
  return {
    tool: {
      name: "process_stop",
      description: "Stop a managed durable process by id.",
      parameters: processStopSchema
    },
    execute: async (args, _toolContext, toolCall) => {
      const payload = args as ProcessStopArgs;
      const signal = payload.signal ?? "SIGTERM";
      const processInfo = await processes.stop(payload.processId, signal);
      const text = [
        `Process stopped: ${processInfo.id}`,
        `name: ${processInfo.name}`,
        `signal: ${signal}`,
        `status: ${processInfo.status}`
      ].join("\n");
      return {
        toolMessage: buildToolMessage(toolCall, text, false, {
          processId: processInfo.id,
          signal,
          status: processInfo.status
        }),
        files: []
      };
    }
  };
}

export function buildProcessStopAllTool(processes: Processes): ToolDefinition {
  return {
    tool: {
      name: "process_stop_all",
      description: "Stop all managed durable processes.",
      parameters: processStopAllSchema
    },
    execute: async (args, _toolContext, toolCall) => {
      const payload = args as ProcessStopAllArgs;
      const signal = payload.signal ?? "SIGTERM";
      const stopped = await processes.stopAll(signal);
      const text = `Stopped ${stopped.length} process${stopped.length === 1 ? "" : "es"} with ${signal}.`;
      return {
        toolMessage: buildToolMessage(toolCall, text, false, {
          count: stopped.length,
          signal
        }),
        files: []
      };
    }
  };
}

function buildToolMessage(
  toolCall: { id: string; name: string },
  text: string,
  isError: boolean,
  details?: Record<string, unknown>
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text }],
    details,
    isError,
    timestamp: Date.now()
  };
}

async function resolveProcessPermissions(
  currentPermissions: SessionPermissions,
  requestedTags: string[] | undefined
): Promise<SessionPermissions> {
  const processPermissions: SessionPermissions = {
    workingDir: currentPermissions.workingDir,
    writeDirs: [],
    readDirs: [],
    network: false
  };
  if (!requestedTags || requestedTags.length === 0) {
    return processPermissions;
  }
  const permissionTags = permissionTagsNormalize(requestedTags);
  await permissionTagsValidate(currentPermissions, permissionTags);
  permissionTagsApply(processPermissions, permissionTags);
  return processPermissions;
}
