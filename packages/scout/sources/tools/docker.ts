import path from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";

import type { ToolDefinition } from "./types.js";

const schema = Type.Object(
  {
    image: Type.String({ minLength: 1 }),
    command: Type.Array(Type.String({ minLength: 1 })),
    workdir: Type.Optional(Type.String({ minLength: 1 })),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
    timeoutMs: Type.Optional(Type.Number({ minimum: 100 })),
    network: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

type DockerArgs = Static<typeof schema>;

export function buildDockerRunTool(): ToolDefinition {
  return {
    tool: {
      name: "docker_run",
      description: "Run a one-off docker command in the configured workspace.",
      parameters: schema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as DockerArgs;
      const dockerRuntime = toolContext.dockerRuntime;
      if (!dockerRuntime) {
        throw new Error("Docker runtime unavailable");
      }

      const assistant = toolContext.assistant ?? {};
      const workspaceDir = assistant.workspaceDir;
      if (!workspaceDir) {
        throw new Error("Assistant workspaceDir missing in settings");
      }
      const allowedImages = assistant.allowedDockerImages ?? [];
      if (allowedImages.length > 0 && !allowedImages.includes(payload.image)) {
        throw new Error(`Docker image not allowed: ${payload.image}`);
      }

      const containerWorkspacePath = assistant.containerWorkspacePath ?? "/workspace";
      const relativeWorkdir = payload.workdir ?? ".";
      const resolvedHostWorkdir = resolveWorkspacePath(workspaceDir, relativeWorkdir);
      const relative = path.relative(path.resolve(workspaceDir), resolvedHostWorkdir);
      const containerWorkdir = path.posix.join(
        containerWorkspacePath,
        relative.split(path.sep).join(path.posix.sep)
      );

      const result = await dockerRuntime.runOneOff({
        image: payload.image,
        command: payload.command,
        workingDir: containerWorkdir,
        env: payload.env,
        timeoutMs: payload.timeoutMs,
        network: payload.network,
        mounts: [
          {
            hostPath: path.resolve(workspaceDir),
            containerPath: containerWorkspacePath,
            readOnly: false
          }
        ]
      });

      const text = `Exit: ${result.exitCode ?? "unknown"}\n${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`.trim();
      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text }],
        isError: false,
        timestamp: Date.now()
      };
      return { toolMessage };
    }
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
