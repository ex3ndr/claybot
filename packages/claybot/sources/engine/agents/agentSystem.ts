import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";

import { createId } from "@paralleldrive/cuid2";

import { getLogger } from "../../log.js";
import type { FileStore } from "../../files/store.js";
import type { AuthStore } from "../../auth/store.js";
import type { Config } from "@/types";
import { cuid2Is } from "../../utils/cuid2Is.js";
import type { ConnectorRegistry } from "../modules/connectorRegistry.js";
import type { ImageGenerationRegistry } from "../modules/imageGenerationRegistry.js";
import type { ToolResolver } from "../modules/toolResolver.js";
import type { PluginManager } from "../plugins/manager.js";
import type { EngineEventBus } from "../ipc/events.js";
import type { InferenceRouter } from "../modules/inference/router.js";
import type { Crons } from "../cron/crons.js";
import type { Heartbeats } from "../heartbeat/heartbeats.js";
import { Agent } from "./agent.js";
import { AgentInbox } from "./ops/agentInbox.js";
import type { AgentInboxItem, AgentInboxResult, AgentPostTarget } from "./ops/agentTypes.js";
import type { AgentDescriptor, AgentFetchStrategy } from "./ops/agentDescriptorTypes.js";
import { agentDescriptorMatchesStrategy } from "./ops/agentDescriptorMatchesStrategy.js";
import { agentPathForDescriptor } from "./ops/agentPathForDescriptor.js";
import { agentTimestampGet } from "./ops/agentTimestampGet.js";
import { agentDescriptorRead } from "./ops/agentDescriptorRead.js";
import { agentStateRead } from "./ops/agentStateRead.js";

const logger = getLogger("engine.agent-system");

type AgentEntry = {
  agentId: string;
  descriptor: AgentDescriptor;
  agent: Agent;
  inbox: AgentInbox;
  running: boolean;
};

export type AgentSystemOptions = {
  config: Config;
  eventBus: EngineEventBus;
  connectorRegistry: ConnectorRegistry;
  imageRegistry: ImageGenerationRegistry;
  toolResolver: ToolResolver;
  pluginManager: PluginManager;
  inferenceRouter: InferenceRouter;
  fileStore: FileStore;
  authStore: AuthStore;
};

export class AgentSystem {
  config: Config;
  readonly eventBus: EngineEventBus;
  readonly connectorRegistry: ConnectorRegistry;
  readonly imageRegistry: ImageGenerationRegistry;
  readonly toolResolver: ToolResolver;
  readonly pluginManager: PluginManager;
  readonly inferenceRouter: InferenceRouter;
  readonly fileStore: FileStore;
  readonly authStore: AuthStore;
  private _crons: Crons | null = null;
  private _heartbeats: Heartbeats | null = null;
  private entries = new Map<string, AgentEntry>();
  private keyMap = new Map<string, string>();
  private stage: "idle" | "loaded" | "running" = "idle";

  constructor(options: AgentSystemOptions) {
    this.config = options.config;
    this.eventBus = options.eventBus;
    this.connectorRegistry = options.connectorRegistry;
    this.imageRegistry = options.imageRegistry;
    this.toolResolver = options.toolResolver;
    this.pluginManager = options.pluginManager;
    this.inferenceRouter = options.inferenceRouter;
    this.fileStore = options.fileStore;
    this.authStore = options.authStore;
  }

  get crons(): Crons {
    if (!this._crons) {
      throw new Error("Crons not set");
    }
    return this._crons;
  }

  setCrons(crons: Crons): void {
    this._crons = crons;
  }

  get heartbeats(): Heartbeats {
    if (!this._heartbeats) {
      throw new Error("Heartbeats not set");
    }
    return this._heartbeats;
  }

  setHeartbeats(heartbeats: Heartbeats): void {
    this._heartbeats = heartbeats;
  }

  async load(): Promise<void> {
    if (this.stage !== "idle") {
      return;
    }
    await fs.mkdir(this.config.agentsDir, { recursive: true });
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(this.config.agentsDir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const agentId = entry.name;
      let descriptor: AgentDescriptor | null = null;
      let state: Awaited<ReturnType<typeof agentStateRead>> = null;
      try {
        descriptor = await agentDescriptorRead(this.config, agentId);
        state = await agentStateRead(this.config, agentId);
      } catch (error) {
        logger.warn({ agentId, error }, "Agent restore skipped due to invalid persisted data");
        continue;
      }
      if (!descriptor || !state) {
        continue;
      }
      const inbox = new AgentInbox(agentId);
      const agent = Agent.restore(agentId, descriptor, state, inbox, this);
      const registered = this.registerEntry({ agentId, descriptor, agent, inbox });
      registered.inbox.post({ type: "restore" });
      logger.info({ agentId }, "Agent restored");
      this.startEntryIfRunning(registered);
    }

    this.stage = "loaded";
  }

  async start(): Promise<void> {
    if (this.stage === "running") {
      return;
    }
    if (this.stage === "idle") {
      throw new Error("AgentSystem must load before starting");
    }
    this.stage = "running";
    for (const entry of this.entries.values()) {
      this.startEntryIfRunning(entry);
    }
  }

  async post(target: AgentPostTarget, item: AgentInboxItem): Promise<void> {
    if (this.stage === "idle" && item.type === "message") {
      const agentType = "descriptor" in target ? target.descriptor.type : "agent";
      logger.warn({ agentType }, "AgentSystem received message before load");
    }
    const entry = await this.resolveEntry(target, item);
    entry.inbox.post(item);
    this.startEntryIfRunning(entry);
  }

  async postAndAwait(
    target: AgentPostTarget,
    item: AgentInboxItem
  ): Promise<AgentInboxResult> {
    const entry = await this.resolveEntry(target, item);
    const completion = this.createCompletion();
    entry.inbox.post(item, completion.completion);
    this.startEntryIfRunning(entry);
    return completion.promise;
  }

  reload(config: Config): void {
    this.config = config;
  }

  resetAgent(agentId: string): boolean {
    const entry = this.entries.get(agentId);
    if (!entry) {
      return false;
    }
    entry.inbox.post({ type: "reset" });
    this.startEntryIfRunning(entry);
    return true;
  }

  agentFor(strategy: AgentFetchStrategy): string | null {
    const candidates = Array.from(this.entries.values()).filter((entry) => {
      return agentDescriptorMatchesStrategy(entry.descriptor, strategy);
    });
    if (candidates.length === 0) {
      return null;
    }
    candidates.sort((a, b) => {
      const aTime = agentTimestampGet(a.agent.state.updatedAt);
      const bTime = agentTimestampGet(b.agent.state.updatedAt);
      return bTime - aTime;
    });
    return candidates[0]?.agentId ?? null;
  }

  private async resolveEntry(
    target: AgentPostTarget,
    item: AgentInboxItem
  ): Promise<AgentEntry> {
    if ("agentId" in target) {
      const existing = this.entries.get(target.agentId);
      if (existing) {
        return existing;
      }
      const restored = await this.restoreAgent(target.agentId);
      if (restored) {
        return restored;
      }
      throw new Error(`Agent not found: ${target.agentId}`);
    }

    const descriptor = target.descriptor;
    const key = agentPathForDescriptor(descriptor);
    if (key) {
      const agentId = this.keyMap.get(key);
      if (agentId) {
        const existing = this.entries.get(agentId);
        if (existing) {
          return existing;
        }
      }
    }

    if (descriptor.type === "cron" && cuid2Is(descriptor.id)) {
      const existing = this.entries.get(descriptor.id);
      if (existing) {
        return existing;
      }
    }

    const agentId = descriptor.type === "cron" && cuid2Is(descriptor.id) ? descriptor.id : createId();
    const resolvedDescriptor =
      descriptor.type === "subagent" && descriptor.id !== agentId
        ? { ...descriptor, id: agentId }
        : descriptor;
    const inbox = new AgentInbox(agentId);
    const agent = await Agent.create(agentId, resolvedDescriptor, inbox, this);
    const entry = this.registerEntry({
      agentId,
      descriptor: resolvedDescriptor,
      agent,
      inbox
    });
    return entry;
  }

  private registerEntry(input: {
    agentId: string;
    descriptor: AgentDescriptor;
    agent: Agent;
    inbox: AgentInbox;
  }): AgentEntry {
    const entry: AgentEntry = {
      agentId: input.agentId,
      descriptor: input.descriptor,
      agent: input.agent,
      inbox: input.inbox,
      running: false
    };
    this.entries.set(input.agentId, entry);
    const key = agentPathForDescriptor(input.descriptor);
    if (key) {
      this.keyMap.set(key, input.agentId);
    }
    return entry;
  }

  private startEntryIfRunning(entry: AgentEntry): void {
    if (this.stage !== "running" || entry.running) {
      return;
    }
    entry.running = true;
    entry.agent.start();
  }

  private async restoreAgent(agentId: string): Promise<AgentEntry | null> {
    let descriptor: AgentDescriptor | null = null;
    let state: Awaited<ReturnType<typeof agentStateRead>> = null;
    try {
      descriptor = await agentDescriptorRead(this.config, agentId);
      state = await agentStateRead(this.config, agentId);
    } catch (error) {
      logger.warn({ agentId, error }, "Agent restore failed due to invalid persisted data");
      return null;
    }
    if (!descriptor || !state) {
      return null;
    }
    const inbox = new AgentInbox(agentId);
    const agent = Agent.restore(agentId, descriptor, state, inbox, this);
    const entry = this.registerEntry({ agentId, descriptor, agent, inbox });
    entry.inbox.post({ type: "restore" });
    this.startEntryIfRunning(entry);
    return entry;
  }

  private createCompletion(): {
    promise: Promise<AgentInboxResult>;
    completion: {
      resolve: (result: AgentInboxResult) => void;
      reject: (error: Error) => void;
    };
  } {
    let resolve: ((result: AgentInboxResult) => void) | null = null;
    let reject: ((error: Error) => void) | null = null;
    const promise = new Promise<AgentInboxResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return {
      promise,
      completion: {
        resolve: (result) => resolve?.(result),
        reject: (error) => reject?.(error)
      }
    };
  }
}
