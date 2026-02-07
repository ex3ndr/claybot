import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
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
import type { AgentDescriptor, Connector, Signal } from "@/types";
import type { PluginManager } from "../plugins/manager.js";
import type { InferenceRouter } from "../modules/inference/router.js";
import type { Crons } from "../cron/crons.js";
import { ConfigModule } from "../config/configModule.js";
import { Signals } from "../signals/signals.js";

describe("Agent", () => {
  it("persists descriptor, state, and history on create", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "daycare-agent-"));
    try {
      const config = configResolve(
        { engine: { dataDir: dir }, assistant: { workspaceDir: dir } },
        path.join(dir, "settings.json")
      );
      const agentSystem = new AgentSystem({
        config: new ConfigModule(config),
        eventBus: new EngineEventBus(),
        connectorRegistry: new ConnectorRegistry({
          onMessage: async () => undefined
        }),
        imageRegistry: new ImageGenerationRegistry(),
        toolResolver: new ToolResolver(),
        pluginManager: {} as unknown as PluginManager,
        inferenceRouter: {} as unknown as InferenceRouter,
        fileStore: new FileStore(config),
        authStore: new AuthStore(config)
      });
      agentSystem.setCrons({} as unknown as Crons);

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

  it("sends reset confirmation from agent for user resets with context", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "daycare-agent-"));
    try {
      const config = configResolve(
        { engine: { dataDir: dir }, assistant: { workspaceDir: dir } },
        path.join(dir, "settings.json")
      );
      const connectorRegistry = new ConnectorRegistry({
        onMessage: async () => undefined
      });
      const sendMessage = vi.fn(async () => undefined);
      const connector: Connector = {
        capabilities: { sendText: true },
        onMessage: () => () => undefined,
        sendMessage
      };
      const registerResult = connectorRegistry.register("telegram", connector);
      expect(registerResult).toEqual({ ok: true, status: "loaded" });

      const agentSystem = new AgentSystem({
        config: new ConfigModule(config),
        eventBus: new EngineEventBus(),
        connectorRegistry,
        imageRegistry: new ImageGenerationRegistry(),
        toolResolver: new ToolResolver(),
        pluginManager: {} as unknown as PluginManager,
        inferenceRouter: {} as unknown as InferenceRouter,
        fileStore: new FileStore(config),
        authStore: new AuthStore(config)
      });
      agentSystem.setCrons({} as unknown as Crons);
      await agentSystem.load();
      await agentSystem.start();

      const descriptor: AgentDescriptor = {
        type: "user",
        connector: "telegram",
        channelId: "channel-1",
        userId: "user-1"
      };
      const result = await agentSystem.postAndAwait(
        { descriptor },
        {
          type: "reset",
          message: "Manual reset requested by the user.",
          context: { messageId: "42" }
        }
      );

      expect(result).toEqual({ type: "reset", ok: true });
      expect(sendMessage).toHaveBeenCalledWith("channel-1", {
        text: "Session reset.",
        replyToMessageId: "42"
      });

      await connectorRegistry.unregisterAll("test");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drops queued signals after unsubscribe before agent handles inbox", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "daycare-agent-"));
    try {
      const config = configResolve(
        { engine: { dataDir: dir }, assistant: { workspaceDir: dir } },
        path.join(dir, "settings.json")
      );
      const eventBus = new EngineEventBus();
      const agentSystem = new AgentSystem({
        config: new ConfigModule(config),
        eventBus,
        connectorRegistry: new ConnectorRegistry({
          onMessage: async () => undefined
        }),
        imageRegistry: new ImageGenerationRegistry(),
        toolResolver: new ToolResolver(),
        pluginManager: {} as unknown as PluginManager,
        inferenceRouter: {} as unknown as InferenceRouter,
        fileStore: new FileStore(config),
        authStore: new AuthStore(config)
      });
      agentSystem.setCrons({} as unknown as Crons);
      const signals = new Signals({
        eventBus,
        configDir: config.configDir,
        onDeliver: async (signal, subscriptions) => {
          await agentSystem.signalDeliver(signal, subscriptions);
        }
      });
      agentSystem.setSignals(signals);
      await agentSystem.load();

      const agentId = createId();
      const descriptor: AgentDescriptor = { type: "cron", id: agentId, name: "Signal agent" };
      await agentSystem.post({ descriptor }, { type: "reset", message: "init" });
      signals.subscribe({ agentId, pattern: "build:*:done", silent: true });
      await signals.generate({ type: "build:alpha:done", source: { type: "system" } });
      signals.unsubscribe({ agentId, pattern: "build:*:done" });

      await agentSystem.start();
      await agentSystem.postAndAwait(
        { agentId },
        { type: "reset", message: "flush queue" }
      );

      const historyPath = path.join(config.agentsDir, agentId, "history.jsonl");
      const historyRaw = await readFile(historyPath, "utf8");
      expect(historyRaw.includes("[signal]")).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("delivers queued signal when subscribed at handling time", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "daycare-agent-"));
    try {
      const config = configResolve(
        { engine: { dataDir: dir }, assistant: { workspaceDir: dir } },
        path.join(dir, "settings.json")
      );
      const eventBus = new EngineEventBus();
      const agentSystem = new AgentSystem({
        config: new ConfigModule(config),
        eventBus,
        connectorRegistry: new ConnectorRegistry({
          onMessage: async () => undefined
        }),
        imageRegistry: new ImageGenerationRegistry(),
        toolResolver: new ToolResolver(),
        pluginManager: {} as unknown as PluginManager,
        inferenceRouter: {} as unknown as InferenceRouter,
        fileStore: new FileStore(config),
        authStore: new AuthStore(config)
      });
      agentSystem.setCrons({} as unknown as Crons);
      const signals = new Signals({
        eventBus,
        configDir: config.configDir,
        onDeliver: async (signal, subscriptions) => {
          await agentSystem.signalDeliver(signal, subscriptions);
        }
      });
      agentSystem.setSignals(signals);
      await agentSystem.load();

      const agentId = createId();
      const descriptor: AgentDescriptor = { type: "cron", id: agentId, name: "Signal agent" };
      await agentSystem.post({ descriptor }, { type: "reset", message: "init" });
      signals.subscribe({ agentId, pattern: "build:*:done", silent: true });
      await signals.generate({ type: "build:alpha:done", source: { type: "system" } });
      signals.unsubscribe({ agentId, pattern: "build:*:done" });
      signals.subscribe({ agentId, pattern: "build:*:done", silent: true });

      await agentSystem.start();
      await agentSystem.postAndAwait(
        { agentId },
        { type: "reset", message: "flush queue" }
      );

      const historyPath = path.join(config.agentsDir, agentId, "history.jsonl");
      const historyRaw = await readFile(historyPath, "utf8");
      expect(historyRaw.includes("[signal]")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("emits wake and sleep lifecycle signals", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "daycare-agent-"));
    try {
      const config = configResolve(
        { engine: { dataDir: dir }, assistant: { workspaceDir: dir } },
        path.join(dir, "settings.json")
      );
      const eventBus = new EngineEventBus();
      const agentSystem = new AgentSystem({
        config: new ConfigModule(config),
        eventBus,
        connectorRegistry: new ConnectorRegistry({
          onMessage: async () => undefined
        }),
        imageRegistry: new ImageGenerationRegistry(),
        toolResolver: new ToolResolver(),
        pluginManager: {} as unknown as PluginManager,
        inferenceRouter: {} as unknown as InferenceRouter,
        fileStore: new FileStore(config),
        authStore: new AuthStore(config)
      });
      agentSystem.setCrons({} as unknown as Crons);
      const signals = new Signals({ eventBus, configDir: config.configDir });
      agentSystem.setSignals(signals);
      await agentSystem.load();
      await agentSystem.start();

      const lifecycleTypes: string[] = [];
      const unsubscribe = eventBus.onEvent((event) => {
        if (event.type !== "signal.generated") {
          return;
        }
        const payload = event.payload as Signal;
        if (!payload.type.startsWith("agent:")) {
          return;
        }
        lifecycleTypes.push(payload.type);
      });

      const agentId = createId();
      const descriptor: AgentDescriptor = { type: "cron", id: agentId, name: "Lifecycle agent" };

      await agentSystem.postAndAwait(
        { descriptor },
        { type: "reset", message: "init lifecycle" }
      );
      await agentSystem.postAndAwait(
        { agentId },
        { type: "reset", message: "wake lifecycle" }
      );

      unsubscribe();

      expect(lifecycleTypes).toContain(`agent:${agentId}:sleep`);
      expect(lifecycleTypes).toContain(`agent:${agentId}:wake`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("emits idle lifecycle signal one minute after sleeping", async () => {
    vi.useFakeTimers();
    const dir = await mkdtemp(path.join(os.tmpdir(), "daycare-agent-"));
    try {
      const config = configResolve(
        { engine: { dataDir: dir }, assistant: { workspaceDir: dir } },
        path.join(dir, "settings.json")
      );
      const eventBus = new EngineEventBus();
      const agentSystem = new AgentSystem({
        config: new ConfigModule(config),
        eventBus,
        connectorRegistry: new ConnectorRegistry({
          onMessage: async () => undefined
        }),
        imageRegistry: new ImageGenerationRegistry(),
        toolResolver: new ToolResolver(),
        pluginManager: {} as unknown as PluginManager,
        inferenceRouter: {} as unknown as InferenceRouter,
        fileStore: new FileStore(config),
        authStore: new AuthStore(config)
      });
      agentSystem.setCrons({} as unknown as Crons);
      const signals = new Signals({ eventBus, configDir: config.configDir });
      agentSystem.setSignals(signals);
      await agentSystem.load();
      await agentSystem.start();

      const lifecycleTypes: string[] = [];
      const idleAgentIds: string[] = [];
      const unsubscribe = eventBus.onEvent((event) => {
        if (event.type === "signal.generated") {
          const payload = event.payload as Signal;
          lifecycleTypes.push(payload.type);
          return;
        }
        if (event.type === "agent.idle") {
          const payload = event.payload as { agentId: string };
          idleAgentIds.push(payload.agentId);
        }
      });

      const agentId = createId();
      const descriptor: AgentDescriptor = { type: "cron", id: agentId, name: "Idle agent" };

      await agentSystem.postAndAwait(
        { descriptor },
        { type: "reset", message: "init idle lifecycle" }
      );

      await vi.advanceTimersByTimeAsync(59_000);
      expect(idleAgentIds).toEqual([]);
      expect(lifecycleTypes).not.toContain(`agent:${agentId}:idle`);

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => {
        expect(lifecycleTypes).toContain(`agent:${agentId}:idle`);
      });

      unsubscribe();

      expect(idleAgentIds).toContain(agentId);
    } finally {
      vi.useRealTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cancels pending idle lifecycle signal when agent wakes", async () => {
    vi.useFakeTimers();
    const dir = await mkdtemp(path.join(os.tmpdir(), "daycare-agent-"));
    try {
      const config = configResolve(
        { engine: { dataDir: dir }, assistant: { workspaceDir: dir } },
        path.join(dir, "settings.json")
      );
      const eventBus = new EngineEventBus();
      const agentSystem = new AgentSystem({
        config: new ConfigModule(config),
        eventBus,
        connectorRegistry: new ConnectorRegistry({
          onMessage: async () => undefined
        }),
        imageRegistry: new ImageGenerationRegistry(),
        toolResolver: new ToolResolver(),
        pluginManager: {} as unknown as PluginManager,
        inferenceRouter: {} as unknown as InferenceRouter,
        fileStore: new FileStore(config),
        authStore: new AuthStore(config)
      });
      agentSystem.setCrons({} as unknown as Crons);
      const signals = new Signals({ eventBus, configDir: config.configDir });
      agentSystem.setSignals(signals);
      await agentSystem.load();
      await agentSystem.start();

      const lifecycleTypes: string[] = [];
      const idleAgentIds: string[] = [];
      const unsubscribe = eventBus.onEvent((event) => {
        if (event.type === "signal.generated") {
          const payload = event.payload as Signal;
          lifecycleTypes.push(payload.type);
          return;
        }
        if (event.type === "agent.idle") {
          const payload = event.payload as { agentId: string };
          idleAgentIds.push(payload.agentId);
        }
      });

      const agentId = createId();
      const descriptor: AgentDescriptor = { type: "cron", id: agentId, name: "Wake cancel agent" };

      await agentSystem.postAndAwait(
        { descriptor },
        { type: "reset", message: "initial sleep" }
      );

      await vi.advanceTimersByTimeAsync(30_000);

      await agentSystem.postAndAwait(
        { agentId },
        { type: "reset", message: "wake before idle deadline" }
      );

      await vi.advanceTimersByTimeAsync(30_000);
      expect(idleAgentIds).toEqual([]);
      expect(lifecycleTypes).not.toContain(`agent:${agentId}:idle`);

      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(() => {
        expect(lifecycleTypes).toContain(`agent:${agentId}:idle`);
      });
      unsubscribe();

      expect(idleAgentIds).toEqual([agentId]);
    } finally {
      vi.useRealTimers();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
