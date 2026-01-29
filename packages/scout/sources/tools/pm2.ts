import path from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import type { ToolDefinition } from "./types.js";
import type { Pm2ProcessConfig } from "../modules/runtime/pm2.js";

const schema = Type.Object(
  {
    action: Type.Union([
      Type.Literal("list"),
      Type.Literal("start"),
      Type.Literal("stop"),
      Type.Literal("restart"),
      Type.Literal("delete")
    ]),
    name: Type.Optional(Type.String({ minLength: 1 })),
    script: Type.Optional(Type.String({ minLength: 1 })),
    args: Type.Optional(Type.Array(Type.String())),
    cwd: Type.Optional(Type.String({ minLength: 1 })),
    env: Type.Optional(Type.Record(Type.String(), Type.String()))
  },
  { additionalProperties: false }
);

type Pm2Args = Static<typeof schema>;

export function buildPm2Tool(): ToolDefinition {
  return {
    tool: {
      name: "pm2_manage",
      description: "Manage PM2 processes (list/start/stop/restart/delete).",
      parameters: schema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as Pm2Args;
      const pm2Runtime = toolContext.pm2Runtime;
      if (!pm2Runtime) {
        throw new Error("PM2 runtime unavailable");
      }

      const assistant = toolContext.assistant ?? {};
      const allowedProcesses = assistant.allowedPm2Processes ?? [];
      const workspaceDir = assistant.workspaceDir;
      if (!workspaceDir) {
        throw new Error("Assistant workspaceDir missing in settings");
      }

      if (payload.action === "list") {
        const list = await pm2Runtime.listProcesses();
        const summary = list.map((entry) => {
          const env = (entry as { pm2_env?: { status?: string; pm_cwd?: string } }).pm2_env;
          return {
            name: entry.name ?? "",
            pid: entry.pid ?? null,
            status: env?.status ?? "unknown",
            cwd: env?.pm_cwd ?? null
          };
        });
        return {
          toolMessage: buildToolMessage(toolCall, JSON.stringify(summary, null, 2))
        };
      }

      if (!payload.name) {
        throw new Error("Missing process name");
      }

      if (allowedProcesses.length > 0 && !allowedProcesses.includes(payload.name)) {
        throw new Error(`Process not allowed: ${payload.name}`);
      }

      switch (payload.action) {
        case "start": {
          if (!payload.script) {
            throw new Error("Missing script path");
          }
          const resolvedScript = resolveWorkspacePath(workspaceDir, payload.script);
          const resolvedCwd = payload.cwd
            ? resolveWorkspacePath(workspaceDir, payload.cwd)
            : workspaceDir;
          const config: Pm2ProcessConfig = {
            name: payload.name,
            script: resolvedScript,
            args: payload.args,
            cwd: resolvedCwd,
            env: payload.env
          };
          await pm2Runtime.startProcess(config);
          return { toolMessage: buildToolMessage(toolCall, `PM2 started ${payload.name}.`) };
        }
        case "stop":
          await pm2Runtime.stopProcess(payload.name);
          return { toolMessage: buildToolMessage(toolCall, `PM2 stopped ${payload.name}.`) };
        case "restart":
          await pm2Runtime.restartProcess(payload.name);
          return { toolMessage: buildToolMessage(toolCall, `PM2 restarted ${payload.name}.`) };
        case "delete":
          await pm2Runtime.deleteProcess(payload.name);
          return { toolMessage: buildToolMessage(toolCall, `PM2 deleted ${payload.name}.`) };
        default:
          throw new Error("Unsupported PM2 action");
      }
    }
  };
}

function buildToolMessage(toolCall: { id: string; name: string }, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now()
  };
}

function resolveWorkspacePath(workspaceDir: string, inputPath: string): string {
  const root = path.resolve(workspaceDir);
  const resolved = path.resolve(root, inputPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path must stay within workspace: ${inputPath}`);
  }
  return resolved;
}
