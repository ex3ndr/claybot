import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { Agent } from "./agent.js";
import type { AgentEngine } from "./agentTypes.js";
import type { AgentRuntime } from "../tools/types.js";
import { SessionStore } from "../sessions/store.js";
import type { SessionPermissions } from "../permissions.js";
import type { SessionDescriptor } from "../sessions/descriptor.js";
import type { SessionState } from "../sessions/sessionStateTypes.js";
import type { ConnectorRegistry, ImageGenerationRegistry, ToolResolver } from "../modules.js";
import type { InferenceRouter } from "../inference/router.js";
import type { FileStore } from "../../files/store.js";
import type { AuthStore } from "../../auth/store.js";
import type { PluginManager } from "../plugins/manager.js";
import type { EngineEventBus } from "../ipc/events.js";
import type { CronStore } from "../cron/cronStore.js";
import type { CronScheduler } from "../cron/cronScheduler.js";

const defaultPermissions: SessionPermissions = {
  workingDir: "/tmp/work",
  writeDirs: ["/tmp/work"],
  readDirs: ["/tmp/work"],
  web: false
};

const stubRuntime = (): AgentRuntime =>
  ({
    startBackgroundAgent: async () => ({ sessionId: "stub" }),
    sendSessionMessage: async () => {},
    runHeartbeatNow: async () => ({ ran: 0, taskIds: [] }),
    addHeartbeatTask: async () => ({
      id: "stub",
      title: "stub",
      prompt: "stub",
      filePath: "/tmp/heartbeat.md"
    }),
    listHeartbeatTasks: async () => [],
    removeHeartbeatTask: async () => ({ removed: false })
  }) satisfies AgentRuntime;

const stub = <T>(): T => ({} as unknown as T);

async function createEngine(): Promise<{
  engine: AgentEngine;
  store: SessionStore;
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "claybot-agent-"));
  const store = new SessionStore<SessionState>({ basePath: dir });
  const engine: AgentEngine = {
    getSessionStore: () => store,
    getDefaultPermissions: () => ({
      ...defaultPermissions,
      writeDirs: [...defaultPermissions.writeDirs],
      readDirs: [...defaultPermissions.readDirs]
    }),
    getSettings: () => ({}),
    getConfigDir: () => "/tmp",
    getConnectorRegistry: () => stub<ConnectorRegistry>(),
    getImageRegistry: () => stub<ImageGenerationRegistry>(),
    getToolResolver: () => stub<ToolResolver>(),
    getInferenceRouter: () => stub<InferenceRouter>(),
    getFileStore: () => stub<FileStore>(),
    getAuthStore: () => stub<AuthStore>(),
    getPluginManager: () => stub<PluginManager>(),
    getEventBus: () => stub<EngineEventBus>(),
    getCronStore: () => null as CronStore | null,
    getCronScheduler: () => null as CronScheduler | null,
    getAgentRuntime: () => stubRuntime(),
    isVerbose: () => false
  };
  return {
    engine,
    store,
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

describe("Agent", () => {
  it("creates and loads an agent by session id", async () => {
    const { engine, cleanup } = await createEngine();
    try {
      const descriptor: SessionDescriptor = {
        type: "user",
        connector: "slack",
        channelId: "channel-1",
        userId: "user-1"
      };
      const sessionId = "a".repeat(24);
      const created = await Agent.create(descriptor, sessionId, engine);
      expect(created.session.id).toBe(sessionId);

      const loaded = await Agent.load(descriptor, sessionId, engine);
      expect(loaded.descriptor).toEqual(descriptor);
    } finally {
      await cleanup();
    }
  });

  it("rejects loads when the descriptor does not match", async () => {
    const { engine, cleanup } = await createEngine();
    try {
      const descriptor: SessionDescriptor = {
        type: "user",
        connector: "slack",
        channelId: "channel-1",
        userId: "user-1"
      };
      const sessionId = "b".repeat(24);
      await Agent.create(descriptor, sessionId, engine);

      const mismatch: SessionDescriptor = {
        type: "user",
        connector: "discord",
        channelId: "channel-1",
        userId: "user-1"
      };

      await expect(Agent.load(mismatch, sessionId, engine)).rejects.toThrow(
        "Agent descriptor mismatch"
      );
    } finally {
      await cleanup();
    }
  });

  it("enqueues messages and persists incoming entries", async () => {
    const { engine, store, dir, cleanup } = await createEngine();
    try {
      const descriptor: SessionDescriptor = {
        type: "user",
        connector: "slack",
        channelId: "channel-1",
        userId: "user-1"
      };
      const sessionId = "c".repeat(24);
      const agent = await Agent.create(descriptor, sessionId, engine);

      const entry = agent.receive({
        source: "slack",
        message: { text: "hello", files: [] },
        context: { channelId: "channel-1", userId: "user-1" }
      });

      expect(entry.message.text).toBe("hello");
      expect(agent.session.size).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 20));

      const filePath = path.join(dir, `${agent.session.storageId}.jsonl`);
      const raw = await readFile(filePath, "utf8");
      expect(raw).toContain("\"type\":\"incoming\"");
      expect(raw).toContain("\"type\":\"state\"");
    } finally {
      await cleanup();
    }
  });
});
