import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { SessionPermissions, ToolExecutionContext } from "@/types";
import { configResolve } from "../../../config/configResolve.js";
import { agentPermanentList } from "../../agents/ops/agentPermanentList.js";
import { agentStateRead } from "../../agents/ops/agentStateRead.js";
import { permanentAgentToolBuild } from "./permanentAgentToolBuild.js";

const toolCall = { id: "tool-1", name: "create_permanent_agent" };

describe("permanentAgentToolBuild", () => {
  it("applies creator-granted permissions during permanent agent creation", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "daycare-permanent-tool-"));
    try {
      const config = configResolve(
        {
          engine: { dataDir: dir },
          assistant: { workspaceDir: dir }
        },
        path.join(dir, "settings.json")
      );
      const updateAgentDescriptor = vi.fn();
      const updateAgentPermissions = vi.fn();
      const context = contextBuild(
        buildPermissions({ network: true, readDirs: ["/tmp"] }),
        {
          config: { current: config },
          updateAgentDescriptor,
          updateAgentPermissions
        }
      );
      const tool = permanentAgentToolBuild();

      await tool.execute(
        {
          name: "ops",
          description: "Ops automation",
          systemPrompt: "Keep things running",
          permissions: ["@network", "@read:/tmp"]
        },
        context,
        toolCall
      );

      const agents = await agentPermanentList(config);
      const created = agents.find((entry) => entry.descriptor.name === "ops") ?? null;
      expect(created).not.toBeNull();
      const state = await agentStateRead(config, created!.agentId);
      expect(state?.permissions.network).toBe(true);
      expect(state?.permissions.readDirs).toContain(path.resolve("/tmp"));
      expect(updateAgentDescriptor).toHaveBeenCalledTimes(1);
      expect(updateAgentPermissions).toHaveBeenCalledTimes(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects permissions that the creator does not have", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "daycare-permanent-tool-deny-"));
    try {
      const config = configResolve(
        {
          engine: { dataDir: dir },
          assistant: { workspaceDir: dir }
        },
        path.join(dir, "settings.json")
      );
      const context = contextBuild(
        buildPermissions({ network: false }),
        {
          config: { current: config },
          updateAgentDescriptor: vi.fn(),
          updateAgentPermissions: vi.fn()
        }
      );
      const tool = permanentAgentToolBuild();

      await expect(
        tool.execute(
          {
            name: "ops",
            description: "Ops automation",
            systemPrompt: "Keep things running",
            permissions: ["@network"]
          },
          context,
          toolCall
        )
      ).rejects.toThrow("Cannot attach permission");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function buildPermissions(
  overrides: Partial<SessionPermissions>
): SessionPermissions {
  return {
    workingDir: "/workspace",
    writeDirs: ["/workspace"],
    readDirs: [],
    network: false,
    ...overrides
  };
}

function contextBuild(
  permissions: SessionPermissions,
  agentSystem: {
    config: { current: ReturnType<typeof configResolve> };
    updateAgentDescriptor: (agentId: string, descriptor: unknown) => void;
    updateAgentPermissions: (
      agentId: string,
      nextPermissions: SessionPermissions,
      updatedAt: number
    ) => void;
  }
): ToolExecutionContext {
  return {
    connectorRegistry: null as unknown as ToolExecutionContext["connectorRegistry"],
    fileStore: null as unknown as ToolExecutionContext["fileStore"],
    auth: null as unknown as ToolExecutionContext["auth"],
    logger: console as unknown as ToolExecutionContext["logger"],
    assistant: null,
    permissions,
    agent: { id: "creator-agent" } as unknown as ToolExecutionContext["agent"],
    source: "test",
    messageContext: {},
    agentSystem: agentSystem as unknown as ToolExecutionContext["agentSystem"],
    heartbeats: null as unknown as ToolExecutionContext["heartbeats"]
  };
}
