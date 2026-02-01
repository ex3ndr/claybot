import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { Agent } from "./agent.js";
import type { AgentRuntime } from "@/types";
import { SessionStore } from "../sessions/store.js";
import type { SessionPermissions } from "@/types";
import type { SessionDescriptor } from "../sessions/descriptor.js";
import type { SessionState } from "../sessions/sessionStateTypes.js";
import type { AgentSystemContext } from "./agentTypes.js";
import type { ConnectorRegistry } from "../modules/connectorRegistry.js";
import type { ImageGenerationRegistry } from "../modules/imageGenerationRegistry.js";
import type { ToolResolver } from "../modules/toolResolver.js";
import type { InferenceRouter } from "../modules/inference/router.js";
import type { FileStore } from "../../files/store.js";
import type { AuthStore } from "../../auth/store.js";
import type { PluginManager } from "../plugins/manager.js";
import type { EngineEventBus } from "../ipc/events.js";
import type { Crons } from "../cron/crons.js";
import { configResolve } from "../../config/configResolve.js";

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

async function createAgentSystem(): Promise<{
  agentSystem: AgentSystemContext;
  store: SessionStore;
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "claybot-agent-"));
  const store = new SessionStore<SessionState>({ basePath: dir });
  const config = configResolve(
    {
      engine: { dataDir: dir },
      assistant: { workspaceDir: defaultPermissions.workingDir }
    },
    path.join(dir, "settings.json")
  );
  const agentSystem = {
    config,
    sessionStore: store,
    connectorRegistry: stub<ConnectorRegistry>(),
    imageRegistry: stub<ImageGenerationRegistry>(),
    toolResolver: stub<ToolResolver>(),
    inferenceRouter: stub<InferenceRouter>(),
    fileStore: stub<FileStore>(),
    authStore: stub<AuthStore>(),
    pluginManager: stub<PluginManager>(),
    eventBus: stub<EngineEventBus>(),
    crons: stub<Crons>(),
    agentRuntime: stubRuntime()
  } satisfies AgentSystemContext;
  return {
    agentSystem,
    store,
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

describe("Agent", () => {
  it("creates and loads an agent by session id", async () => {
    const { agentSystem, cleanup } = await createAgentSystem();
    try {
      const descriptor: SessionDescriptor = {
        type: "user",
        connector: "slack",
        channelId: "channel-1",
        userId: "user-1"
      };
      const sessionId = "a".repeat(24);
      const created = await Agent.create(descriptor, sessionId, agentSystem);
      expect(created.session.id).toBe(sessionId);

      const loaded = await Agent.load(descriptor, sessionId, agentSystem);
      expect(loaded.descriptor).toEqual(descriptor);
    } finally {
      await cleanup();
    }
  });

  it("rejects loads when the descriptor does not match", async () => {
    const { agentSystem, cleanup } = await createAgentSystem();
    try {
      const descriptor: SessionDescriptor = {
        type: "user",
        connector: "slack",
        channelId: "channel-1",
        userId: "user-1"
      };
      const sessionId = "b".repeat(24);
      await Agent.create(descriptor, sessionId, agentSystem);

      const mismatch: SessionDescriptor = {
        type: "user",
        connector: "discord",
        channelId: "channel-1",
        userId: "user-1"
      };

      await expect(Agent.load(mismatch, sessionId, agentSystem)).rejects.toThrow(
        "Agent descriptor mismatch"
      );
    } finally {
      await cleanup();
    }
  });

  it("enqueues messages and persists incoming entries", async () => {
    const { agentSystem, store, dir, cleanup } = await createAgentSystem();
    try {
      const descriptor: SessionDescriptor = {
        type: "user",
        connector: "slack",
        channelId: "channel-1",
        userId: "user-1"
      };
      const sessionId = "c".repeat(24);
      const agent = await Agent.create(descriptor, sessionId, agentSystem);

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
