import { promises as fs } from "node:fs";
import path from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { createId } from "@paralleldrive/cuid2";

import type { ToolDefinition } from "@/types";
import type { AgentState, SessionPermissions } from "@/types";
import { cuid2Is } from "../../../utils/cuid2Is.js";
import { permissionClone } from "../../permissions/permissionClone.js";
import { permissionTagsApply } from "../../permissions/permissionTagsApply.js";
import { permissionTagsNormalize } from "../../permissions/permissionTagsNormalize.js";
import { permissionTagsValidate } from "../../permissions/permissionTagsValidate.js";
import { pathResolveSecure } from "../../permissions/pathResolveSecure.js";
import { agentDescriptorWrite } from "../../agents/ops/agentDescriptorWrite.js";
import { agentHistoryAppend } from "../../agents/ops/agentHistoryAppend.js";
import { agentPermanentList } from "../../agents/ops/agentPermanentList.js";
import type { PermanentAgentSummary } from "../../agents/ops/agentPermanentTypes.js";
import { agentStateRead } from "../../agents/ops/agentStateRead.js";
import { agentStateWrite } from "../../agents/ops/agentStateWrite.js";

const schema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    systemPrompt: Type.String({ minLength: 1 }),
    workspaceDir: Type.Optional(Type.String({ minLength: 1 })),
    agentId: Type.Optional(Type.String({ minLength: 1 })),
    permissions: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }))
  },
  { additionalProperties: false }
);

type PermanentAgentArgs = Static<typeof schema>;

/**
 * Builds the create_permanent_agent tool to create or update permanent agents.
 * Expects: agent name + system prompt are provided; workspaceDir stays within the main workspace.
 */
export function permanentAgentToolBuild(): ToolDefinition {
  return {
    tool: {
      name: "create_permanent_agent",
      description: "Create or update a permanent background agent with a stable name and system prompt.",
      parameters: schema
    },
    execute: async (args, toolContext, toolCall) => {
      const payload = args as PermanentAgentArgs;
      const name = payload.name.trim();
      if (!name) {
        throw new Error("Permanent agent name is required.");
      }
      const description = payload.description.trim();
      if (!description) {
        throw new Error("Permanent agent description is required.");
      }
      const systemPrompt = payload.systemPrompt.trim();
      if (!systemPrompt) {
        throw new Error("Permanent agent system prompt is required.");
      }
      const permissionTags = permissionTagsNormalize(payload.permissions);
      await permissionTagsValidate(toolContext.permissions, permissionTags);

      const config = toolContext.agentSystem.config.current;
      const existingAgents = await agentPermanentList(config);
      const resolvedAgent = resolveExistingAgent(existingAgents, payload.agentId, name);
      const agentId = resolvedAgent?.agentId ?? createId();
      const resolvedWorkspaceDir = payload.workspaceDir
        ? await resolveWorkspaceDir(config.workspaceDir, payload.workspaceDir)
        : resolvedAgent?.descriptor.workspaceDir ?? null;

      const descriptor = {
        type: "permanent" as const,
        id: agentId,
        name,
        description,
        systemPrompt,
        ...(resolvedWorkspaceDir ? { workspaceDir: resolvedWorkspaceDir } : {})
      };

      if (resolvedAgent) {
        await agentDescriptorWrite(config, agentId, descriptor);
        toolContext.agentSystem.updateAgentDescriptor(agentId, descriptor);

        const state = await agentStateRead(config, agentId);
        if (!state) {
          throw new Error("Permanent agent state not found.");
        }
        const permissions = updatePermissions(state.permissions, resolvedWorkspaceDir);
        permissionTagsApply(permissions, permissionTags);
        const nextState: AgentState = {
          ...state,
          permissions,
          updatedAt: Date.now()
        };
        await agentStateWrite(config, agentId, nextState);
        toolContext.agentSystem.updateAgentPermissions(agentId, nextState.permissions, nextState.updatedAt);
      } else {
        const now = Date.now();
        const permissions = updatePermissions(
          permissionClone(config.defaultPermissions),
          resolvedWorkspaceDir
        );
        permissionTagsApply(permissions, permissionTags);
        const state: AgentState = {
          context: { messages: [] },
          permissions,
          tokens: null,
          stats: {},
          createdAt: now,
          updatedAt: now,
          state: "active"
        };
        await agentDescriptorWrite(config, agentId, descriptor);
        await agentStateWrite(config, agentId, state);
        await agentHistoryAppend(config, agentId, { type: "start", at: now });
        toolContext.agentSystem.updateAgentDescriptor(agentId, descriptor);
        toolContext.agentSystem.updateAgentPermissions(agentId, permissions, now);
      }

      const action = resolvedAgent ? "updated" : "created";
      const toolMessage: ToolResultMessage = {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: `Permanent agent ${action}: ${agentId} (name: ${name}).`
          }
        ],
        isError: false,
        timestamp: Date.now()
      };

      return { toolMessage, files: [] };
    }
  };
}

function resolveExistingAgent(
  agents: PermanentAgentSummary[],
  agentId: string | undefined,
  name: string
): PermanentAgentSummary | null {
  if (agentId) {
    const trimmed = agentId.trim();
    if (!cuid2Is(trimmed)) {
      throw new Error("agentId must be a cuid2 value.");
    }
    const match = agents.find((entry) => entry.agentId === trimmed) ?? null;
    if (!match) {
      throw new Error("Permanent agent not found for the supplied agentId.");
    }
    return match;
  }

  const normalized = normalizeName(name);
  const matches = agents.filter(
    (entry) => normalizeName(entry.descriptor.name) === normalized
  );
  if (matches.length === 0) {
    return null;
  }
  return matches.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

async function resolveWorkspaceDir(workspaceRoot: string, input: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("workspaceDir must be a non-empty string when provided.");
  }
  const target = path.isAbsolute(trimmed)
    ? trimmed
    : path.resolve(workspaceRoot, trimmed);
  const resolved = await pathResolveSecure([workspaceRoot], target);
  await fs.mkdir(resolved.realPath, { recursive: true });
  return resolved.realPath;
}

function updatePermissions(
  permissions: SessionPermissions,
  workspaceDir: string | null
): SessionPermissions {
  if (!workspaceDir) {
    return permissions;
  }
  return {
    ...permissions,
    workingDir: workspaceDir
  };
}
