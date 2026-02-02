import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { createId } from "@paralleldrive/cuid2";
import path from "node:path";

import type { ToolDefinition } from "@/types";
import type { PermissionAccess, PermissionRequest } from "@/types";
import { agentDescriptorTargetResolve } from "../../agents/ops/agentDescriptorTargetResolve.js";

const schema = Type.Object(
  {
    permission: Type.String({ minLength: 1 }),
    reason: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

type PermissionArgs = Static<typeof schema>;

export function buildPermissionRequestTool(): ToolDefinition {
  return {
    tool: {
      name: "request_permission",
      description:
        "Request additional permissions from the user. Emits a connector-specific approval prompt.",
      parameters: schema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as PermissionArgs;
      const connectorRegistry = toolContext.connectorRegistry;
      if (!connectorRegistry) {
        throw new Error("Connector registry unavailable.");
      }

      const descriptor = toolContext.agent.descriptor;
      const isForeground = descriptor.type === "user";
      const foregroundAgentId = isForeground
        ? toolContext.agent.id
        : toolContext.agentSystem.agentFor("most-recent-foreground");
      if (!foregroundAgentId) {
        throw new Error("No foreground agent available for permission requests.");
      }
      const foregroundDescriptor = isForeground
        ? descriptor
        : toolContext.agentSystem.getAgentDescriptor(foregroundAgentId);
      if (!foregroundDescriptor) {
        throw new Error("Foreground agent descriptor not found.");
      }
      const target = agentDescriptorTargetResolve(foregroundDescriptor);
      if (!target) {
        throw new Error("Foreground agent has no user target for permission requests.");
      }
      const connector = connectorRegistry.get(target.connector);
      if (!connector) {
        throw new Error("Connector not available for permission requests.");
      }

      const access = parsePermission(payload.permission);
      if (access.kind !== "web" && !path.isAbsolute(access.path)) {
        throw new Error("Path must be absolute.");
      }

      const agentId = toolContext.agent.id;
      const permission = payload.permission.trim();
      const friendly = describePermission(access);
      const agentName = descriptor.type === "subagent" ? descriptor.name : descriptor.type;
      const heading = isForeground
        ? "Permission request:"
        : `Permission request from background agent "${agentName}":`;
      const text = `${heading}\n${friendly}\nReason: ${payload.reason.trim()}`;
      const request: PermissionRequest = {
        token: createId(),
        agentId,
        reason: payload.reason.trim(),
        message: text,
        permission,
        access
      };

      if (connector.requestPermission) {
        await connector.requestPermission(
          target.targetId,
          request,
          toolContext.messageContext,
          foregroundDescriptor
        );
      } else {
        await connector.sendMessage(target.targetId, {
          text,
          replyToMessageId: toolContext.messageContext.messageId
        });
      }

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: "Permission request sent." }],
        details: {
          permission,
          token: request.token,
          agentId
        },
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage, files: [] };
    }
  };
}

function parsePermission(value: string): PermissionAccess {
  const trimmed = value.trim();
  if (trimmed === "@web") {
    return { kind: "web" };
  }
  if (trimmed.startsWith("@read:")) {
    const pathValue = trimmed.slice("@read:".length).trim();
    if (!pathValue) {
      throw new Error("Read permission requires a path.");
    }
    return { kind: "read", path: pathValue };
  }
  if (trimmed.startsWith("@write:")) {
    const pathValue = trimmed.slice("@write:".length).trim();
    if (!pathValue) {
      throw new Error("Write permission requires a path.");
    }
    return { kind: "write", path: pathValue };
  }
  throw new Error("Permission must be @web, @read:<path>, or @write:<path>.");
}

function describePermission(access: PermissionAccess): string {
  if (access.kind === "web") {
    return "Web access";
  }
  if (access.kind === "read") {
    return `Read access to ${access.path}`;
  }
  return `Write access to ${access.path}`;
}
