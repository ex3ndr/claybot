import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { createId } from "@paralleldrive/cuid2";
import path from "node:path";

import type { ToolDefinition } from "@/types";
import type { PermissionAccess } from "@/types";
import { messageBuildSystemText } from "../../messages/messageBuildSystemText.js";

const schema = Type.Object(
  {
    permission: Type.String({ minLength: 1 }),
    reason: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

type PermissionProxyArgs = Static<typeof schema>;

/**
 * Builds the permission request proxy tool for background agents.
 * This tool allows background agents to request permissions via a foreground agent.
 * Expects: background agent context with an active foreground target.
 */
export function buildPermissionRequestProxyTool(): ToolDefinition {
  return {
    tool: {
      name: "request_permission_via_parent",
      description:
        "Request additional permissions via the foreground agent. Use this when you need read, write, or web access that was not pre-approved.",
      parameters: schema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as PermissionProxyArgs;
      const descriptor = toolContext.agent.descriptor;
      if (descriptor.type === "user") {
        throw new Error("Use request_permission for foreground agents.");
      }

      // Always proxy via the most recent foreground agent.
      const foregroundAgentId = toolContext.agentSystem.agentFor("most-recent-foreground");
      if (!foregroundAgentId) {
        throw new Error("No foreground agent available to proxy permission request.");
      }

      const access = parsePermission(payload.permission);
      if (access.kind !== "web" && !path.isAbsolute(access.path)) {
        throw new Error("Path must be absolute.");
      }

      const permission = payload.permission.trim();
      const agentName = descriptor.type === "subagent" ? descriptor.name : descriptor.type;
      const reason = payload.reason.trim();
      const friendly = describePermission(access);
      const text = [
        `Background agent "${agentName}" (${toolContext.agent.id}) needs permission.`,
        `Access: ${friendly}`,
        `Reason: ${reason}`,
        "Please call request_permission with:",
        `- permission: ${permission}`,
        `- reason: ${reason}`,
        `- agentId: ${toolContext.agent.id}`
      ].join("\n");
      const systemText = messageBuildSystemText(text, "background");
      const token = createId();
      await toolContext.agentSystem.post(
        { agentId: foregroundAgentId },
        { type: "message", message: { text: systemText }, context: {} }
      );

      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: "Permission request sent via foreground agent." }],
        details: {
          permission,
          token,
          foregroundAgentId,
          agentId: toolContext.agent.id
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
