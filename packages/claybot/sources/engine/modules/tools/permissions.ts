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
    reason: Type.String({ minLength: 1 }),
    agentId: Type.Optional(Type.String({ minLength: 1 }))
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

      const target = agentDescriptorTargetResolve(toolContext.agent.descriptor);
      if (!target) {
        throw new Error("Permission requests require a user agent.");
      }
      const connector = connectorRegistry.get(target.connector);
      if (!connector) {
        throw new Error("Connector not available for permission requests.");
      }

      const access = parsePermission(payload.permission);
      if (access.kind !== "web" && !path.isAbsolute(access.path)) {
        throw new Error("Path must be absolute.");
      }

      const { agentId, agentName } = resolvePermissionTarget(payload.agentId, toolContext);
      const permission = payload.permission.trim();
      const reason = payload.reason.trim();
      const reasonText = agentName
        ? `Requested by background agent "${agentName}": ${reason}`
        : reason;
      const friendly = describePermission(access);
      const agentLabel = agentName ? ` for background agent "${agentName}"` : "";
      const text = `Permission request${agentLabel}:\n${friendly}\nReason: ${reasonText}`;
      const request: PermissionRequest = {
        token: createId(),
        agentId,
        reason: reasonText,
        message: text,
        permission,
        access
      };

      if (connector.requestPermission) {
        await connector.requestPermission(
          target.targetId,
          request,
          toolContext.messageContext,
          toolContext.agent.descriptor
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

function resolvePermissionTarget(
  requestedAgentId: string | undefined,
  toolContext: {
    agent: { id: string; descriptor: { type: string } };
    agentSystem: { getAgentDescriptor: (agentId: string) => { type: string; parentAgentId?: string; name?: string } | null };
  }
): { agentId: string; agentName: string | null } {
  const agentId = requestedAgentId?.trim();
  const currentAgentId = toolContext.agent.id;
  if (!agentId || agentId === currentAgentId) {
    return { agentId: currentAgentId, agentName: null };
  }
  if (toolContext.agent.descriptor.type !== "user") {
    throw new Error("Only foreground agents can request permissions for other agents.");
  }
  const descriptor = toolContext.agentSystem.getAgentDescriptor(agentId);
  if (!descriptor) {
    throw new Error("Permission target agent not found.");
  }
  if (descriptor.type !== "subagent") {
    throw new Error("Permission target must be a background agent.");
  }
  if (descriptor.parentAgentId !== currentAgentId) {
    throw new Error("Permission target must be a child of the current agent.");
  }
  return { agentId, agentName: descriptor.name ?? "subagent" };
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
