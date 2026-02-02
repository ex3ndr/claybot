import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { createId } from "@paralleldrive/cuid2";

import { Agent } from "./agent.js";
import { AgentInbox } from "./ops/agentInbox.js";
import { AgentSystem } from "./agentSystem.js";
import { ConnectorRegistry } from "../modules/connectorRegistry.js";
import { ImageGenerationRegistry } from "../modules/imageGenerationRegistry.js";
import { ToolResolver } from "../modules/toolResolver.js";
import { EngineEventBus } from "../ipc/events.js";
import { AuthStore } from "../../auth/store.js";
import { FileStore } from "../../files/store.js";
import { configResolve } from "../../config/configResolve.js";
import type { AgentDescriptor, AgentRuntime } from "@/types";
import type { PluginManager } from "../plugins/manager.js";
import type { InferenceRouter } from "../modules/inference/router.js";
import type { Crons } from "../cron/crons.js";

const stubRuntime = (): AgentRuntime => ({
  startBackgroundAgent: async (_args) => ({ agentId: createId() }),
  sendAgentMessage: async () => {},
  runHeartbeatNow: async () => ({ ran: 0, taskIds: [] }),
  addHeartbeatTask: async () => ({
    id: "stub",
    title: "stub",
    prompt: "stub",
    filePath: "/tmp/heartbeat.md"
  }),
  listHeartbeatTasks: async () => [],
  removeHeartbeatTask: async () => ({ removed: false })
});

describe("Agent", () => {
  it("persists descriptor, state, and history on create", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "claybot-agent-"));
    try {
      const config = configResolve(
        { engine: { dataDir: dir }, assistant: { workspaceDir: dir } },
        path.join(dir, "settings.json")
      );
      const agentSystem = new AgentSystem({
        config,
        eventBus: new EngineEventBus(),
        connectorRegistry: new ConnectorRegistry({ onMessage: async () => undefined }),
        imageRegistry: new ImageGenerationRegistry(),
        toolResolver: new ToolResolver(),
        pluginManager: {} as unknown as PluginManager,
        inferenceRouter: {} as unknown as InferenceRouter,
        fileStore: new FileStore(config),
        authStore: new AuthStore(config),
        crons: {} as unknown as Crons,
        agentRuntime: stubRuntime()
      });

      const agentId = createId();
      const descriptor: AgentDescriptor = {
        type: "user",
        connector: "slack",
        channelId: "channel-1",
        userId: "user-1"
      };
      await Agent.create(agentId, descriptor, new AgentInbox(agentId), agentSystem);

      const descriptorPath = path.join(config.agentsDir, agentId, "descriptor.json");
      const statePath = path.join(config.agentsDir, agentId, "state.json");
      const historyPath = path.join(config.agentsDir, agentId, "history.jsonl");

      const descriptorRaw = await readFile(descriptorPath, "utf8");
      expect(JSON.parse(descriptorRaw)).toEqual(descriptor);

      const stateRaw = await readFile(statePath, "utf8");
      const state = JSON.parse(stateRaw) as { permissions: { workingDir: string } };
      expect(state.permissions.workingDir).toBe(config.defaultPermissions.workingDir);

      const historyRaw = await readFile(historyPath, "utf8");
      expect(historyRaw).toContain("\"type\":\"start\"");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
