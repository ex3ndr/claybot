import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";

import { createId } from "@paralleldrive/cuid2";

import { getLogger } from "../../log.js";
import type { FileStore } from "../../files/store.js";
import type { AuthStore } from "../../auth/store.js";
import type {
  AgentTokenEntry,
  DelayedSignalCancelRepeatKeyInput,
  DelayedSignalScheduleInput,
  PermissionAccess,
  SessionPermissions,
  Signal,
  SignalSubscription
} from "@/types";
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
import type {
  AgentInboxCompletion,
  AgentInboxItem,
  AgentInboxResult,
  AgentPostTarget
} from "./ops/agentTypes.js";
import type { AgentDescriptor, AgentFetchStrategy } from "./ops/agentDescriptorTypes.js";
import { agentDescriptorMatchesStrategy } from "./ops/agentDescriptorMatchesStrategy.js";
import { agentPathForDescriptor } from "./ops/agentPathForDescriptor.js";
import { agentTimestampGet } from "./ops/agentTimestampGet.js";
import { agentDescriptorRead } from "./ops/agentDescriptorRead.js";
import { agentStateRead } from "./ops/agentStateRead.js";
import { agentStateWrite } from "./ops/agentStateWrite.js";
import { AsyncLock } from "../../util/lock.js";
import { permissionClone } from "../permissions/permissionClone.js";
import { permissionAccessApply } from "../permissions/permissionAccessApply.js";
import type { ConfigModule } from "../config/configModule.js";
import type { Signals } from "../signals/signals.js";

const logger = getLogger("engine.agent-system");
const AGENT_IDLE_DELAY_MS = 60_000;
const AGENT_IDLE_REPEAT_KEY = "lifecycle-idle";

type DelayedSignalsFacade = {
  schedule: (input: DelayedSignalScheduleInput) => Promise<unknown>;
  cancelByRepeatKey: (input: DelayedSignalCancelRepeatKeyInput) => Promise<number>;
};

type AgentEntry = {
  agentId: string;
  descriptor: AgentDescriptor;
  agent: Agent;
  inbox: AgentInbox;
  running: boolean;
  lock: AsyncLock;
};

export type AgentSystemOptions = {
  config: ConfigModule;
  eventBus: EngineEventBus;
  connectorRegistry: ConnectorRegistry;
  imageRegistry: ImageGenerationRegistry;
  toolResolver: ToolResolver;
  pluginManager: PluginManager;
  inferenceRouter: InferenceRouter;
  fileStore: FileStore;
  authStore: AuthStore;
  delayedSignals?: DelayedSignalsFacade;
};

export class AgentSystem {
  readonly config: ConfigModule;
  readonly eventBus: EngineEventBus;
  readonly connectorRegistry: ConnectorRegistry;
  readonly imageRegistry: ImageGenerationRegistry;
  readonly toolResolver: ToolResolver;
  readonly pluginManager: PluginManager;
  readonly inferenceRouter: InferenceRouter;
  readonly fileStore: FileStore;
  readonly authStore: AuthStore;
  private readonly delayedSignals: DelayedSignalsFacade | null;
  private _crons: Crons | null = null;
  private _heartbeats: Heartbeats | null = null;
  private _signals: Signals | null = null;
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
    this.delayedSignals = options.delayedSignals ?? null;
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

  get signals(): Signals {
    if (!this._signals) {
      throw new Error("Signals not set");
    }
    return this._signals;
  }

  setSignals(signals: Signals): void {
    this._signals = signals;
  }

  async load(): Promise<void> {
    if (this.stage !== "idle") {
      return;
    }
    await fs.mkdir(this.config.current.agentsDir, { recursive: true });
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(this.config.current.agentsDir, { withFileTypes: true });
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
        descriptor = await agentDescriptorRead(this.config.current, agentId);
        state = await agentStateRead(this.config.current, agentId);
      } catch (error) {
        logger.warn({ agentId, error }, "Agent restore skipped due to invalid persisted data");
        continue;
      }
      if (!descriptor || !state) {
        continue;
      }
      if (state.state === "sleeping") {
        const key = agentPathForDescriptor(descriptor);
        if (key) {
          this.keyMap.set(key, agentId);
        }
        logger.info({ agentId }, "Agent restore skipped (sleeping)");
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
    if (
      this.stage === "idle" &&
      (item.type === "message" || item.type === "system_message")
    ) {
      const agentType = "descriptor" in target ? target.descriptor.type : "agent";
      logger.warn({ agentType }, "AgentSystem received message before load");
    }
    const targetLabel =
      "descriptor" in target ? `descriptor:${target.descriptor.type}` : `agent:${target.agentId}`;
    logger.debug(`post() received itemType=${item.type} target=${targetLabel} stage=${this.stage}`);
    const entry = await this.resolveEntry(target, item);
    await this.enqueueEntry(entry, item, null);
    logger.debug(
      `post() queued item agentId=${entry.agentId} inboxSize=${entry.inbox.size()}`
    );
    this.startEntryIfRunning(entry);
  }

  async postAndAwait(
    target: AgentPostTarget,
    item: AgentInboxItem
  ): Promise<AgentInboxResult> {
    const entry = await this.resolveEntry(target, item);
    const completion = this.createCompletion();
    await this.enqueueEntry(entry, item, completion.completion);
    this.startEntryIfRunning(entry);
    return completion.promise;
  }

  async permissionsForTarget(target: AgentPostTarget): Promise<SessionPermissions> {
    const entry = await this.resolveEntry(target, {
      type: "message",
      message: { text: null },
      context: {}
    });
    return permissionClone(entry.agent.state.permissions);
  }

  /**
   * Resolves a target to its concrete agent id, creating/restoring when needed.
   * Expects: descriptor targets are valid for agent creation.
   */
  async agentIdForTarget(target: AgentPostTarget): Promise<string> {
    const entry = await this.resolveEntry(target, {
      type: "message",
      message: { text: null },
      context: {}
    });
    return entry.agentId;
  }

  async tokensForTarget(target: AgentPostTarget): Promise<AgentTokenEntry | null> {
    const entry = await this.resolveEntry(target, {
      type: "message",
      message: { text: null },
      context: {}
    });
    const tokens = entry.agent.state.tokens;
    if (!tokens) {
      return null;
    }
    return {
      provider: tokens.provider,
      model: tokens.model,
      size: { ...tokens.size }
    };
  }

  async agentExists(agentId: string): Promise<boolean> {
    if (this.entries.has(agentId)) {
      return true;
    }
    try {
      const descriptor = await agentDescriptorRead(this.config.current, agentId);
      return !!descriptor;
    } catch {
      return false;
    }
  }

  async signalDeliver(signal: Signal, subscriptions: SignalSubscription[]): Promise<void> {
    await Promise.all(
      subscriptions.map(async (subscription) => {
        if (signal.source.type === "agent" && signal.source.id === subscription.agentId) {
          return;
        }
        try {
          await this.post(
            { agentId: subscription.agentId },
            {
              type: "signal",
              signal,
              subscriptionPattern: subscription.pattern
            }
          );
        } catch (error) {
          logger.warn(
            {
              signalId: signal.id,
              signalType: signal.type,
              agentId: subscription.agentId,
              pattern: subscription.pattern,
              error
            },
            "Signal delivery skipped"
          );
        }
      })
    );
  }

  /**
   * Aborts the active inference call for a loaded agent target.
   * Returns false when the target is not loaded or has no active inference.
   */
  abortInferenceForTarget(target: AgentPostTarget): boolean {
    const entry = this.findLoadedEntry(target);
    if (!entry) {
      return false;
    }
    const aborted = entry.agent.abortInference();
    logger.info({ agentId: entry.agentId, aborted }, "Abort inference requested");
    return aborted;
  }

  async grantPermission(
    target: AgentPostTarget,
    access: PermissionAccess
  ): Promise<void> {
    const entry = await this.resolveEntry(target, {
      type: "message",
      message: { text: null },
      context: {}
    });
    const applied = permissionAccessApply(entry.agent.state.permissions, access);
    if (!applied) {
      throw new Error("Permission could not be applied.");
    }
    await agentStateWrite(this.config.current, entry.agentId, entry.agent.state);
    this.eventBus.emit("permission.granted", {
      agentId: entry.agentId,
      source: "agent",
      decision: {
        token: "direct",
        approved: true,
        permission: access.kind === "network"
          ? "@network"
          : `@${access.kind}:${access.path}`,
        access
      }
    });
  }

  markStopped(agentId: string, error?: unknown): void {
    const entry = this.entries.get(agentId);
    if (!entry) {
      logger.warn({ agentId }, "Agent stop reported for unknown agent");
      return;
    }
    entry.running = false;
    logger.debug({ agentId, error }, "Agent marked stopped");
  }

  async sleepIfIdle(
    agentId: string,
    reason: "message" | "system_message" | "signal" | "reset" | "permission" | "restore"
  ): Promise<void> {
    const entry = this.entries.get(agentId);
    if (!entry) {
      return;
    }
    let slept = false;
    await entry.lock.inLock(async () => {
      if (entry.inbox.size() > 0) {
        return;
      }
      if (entry.agent.state.state === "sleeping") {
        return;
      }
      entry.agent.state.state = "sleeping";
      await agentStateWrite(this.config.current, agentId, entry.agent.state);
      this.eventBus.emit("agent.sleep", { agentId, reason });
      logger.debug({ agentId, reason }, "Agent entered sleep mode");
      // Keep sleep->idle scheduling under the same lock as wake->cancel to avoid
      // interleaving that could leave stale idle lifecycle signals behind.
      await this.scheduleIdleSignal(agentId);
      slept = true;
    });
    if (slept) {
      await this.signalLifecycle(agentId, "sleep");
    }
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

  /**
   * Returns the descriptor for an agent by id.
   * Returns null if the agent is not found.
   */
  getAgentDescriptor(agentId: string): AgentDescriptor | null {
    const entry = this.entries.get(agentId);
    return entry?.descriptor ?? null;
  }

  /**
   * Updates a loaded agent descriptor in memory without changing its identity.
   * Expects: descriptor type does not require keyMap changes (e.g. permanent agents).
   */
  updateAgentDescriptor(agentId: string, descriptor: AgentDescriptor): void {
    const entry = this.entries.get(agentId);
    if (!entry) {
      return;
    }
    Object.assign(entry.descriptor, descriptor);
    Object.assign(entry.agent.descriptor, descriptor);
  }

  /**
   * Updates a loaded agent's permissions in memory.
   * Expects: permissions have already been persisted if needed.
   */
  updateAgentPermissions(agentId: string, permissions: SessionPermissions, updatedAt: number): void {
    const entry = this.entries.get(agentId);
    if (!entry) {
      return;
    }
    entry.agent.state.permissions = permissions;
    entry.agent.state.updatedAt = updatedAt;
  }

  async inReadLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.config.inReadLock(operation);
  }

  private findLoadedEntry(target: AgentPostTarget): AgentEntry | null {
    if ("agentId" in target) {
      return this.entries.get(target.agentId) ?? null;
    }
    const key = agentPathForDescriptor(target.descriptor);
    if (!key) {
      return null;
    }
    const agentId = this.keyMap.get(key);
    if (!agentId) {
      return null;
    }
    return this.entries.get(agentId) ?? null;
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
      const restored = await this.restoreAgent(target.agentId, { allowSleeping: true });
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
        const restored = await this.restoreAgent(agentId, { allowSleeping: true });
        if (restored) {
          return restored;
        }
      }
    }

    if (descriptor.type === "cron" && cuid2Is(descriptor.id)) {
      const existing = this.entries.get(descriptor.id);
      if (existing) {
        return existing;
      }
      const restored = await this.restoreAgent(descriptor.id, { allowSleeping: true });
      if (restored) {
        return restored;
      }
    }

    const agentId = descriptor.type === "cron" && cuid2Is(descriptor.id) ? descriptor.id : createId();
    const resolvedDescriptor =
      descriptor.type === "subagent" && descriptor.id !== agentId
        ? { ...descriptor, id: agentId }
        : descriptor;
    logger.debug(
      `Creating agent entry agentId=${agentId} type=${resolvedDescriptor.type}`
    );
    const inbox = new AgentInbox(agentId);
    const agent = await Agent.create(agentId, resolvedDescriptor, inbox, this);
    const entry = this.registerEntry({
      agentId,
      descriptor: resolvedDescriptor,
      agent,
      inbox
    });
    logger.debug(`Agent entry registered agentId=${agentId}`);
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
      running: false,
      lock: new AsyncLock()
    };
    this.entries.set(input.agentId, entry);
    const key = agentPathForDescriptor(input.descriptor);
    if (key) {
      this.keyMap.set(key, input.agentId);
    }
    return entry;
  }

  private startEntryIfRunning(entry: AgentEntry): void {
    if (this.stage !== "running") {
      logger.debug(`startEntryIfRunning skipped agentId=${entry.agentId} reason=stage:${this.stage}`);
      return;
    }
    if (entry.running) {
      logger.debug(`startEntryIfRunning skipped agentId=${entry.agentId} reason=already-running`);
      return;
    }
    logger.debug(`startEntryIfRunning starting agentId=${entry.agentId} type=${entry.descriptor.type}`);
    entry.running = true;
    entry.agent.start();
  }

  private async enqueueEntry(
    entry: AgentEntry,
    item: AgentInboxItem,
    completion: AgentInboxCompletion | null
  ): Promise<void> {
    let woke = false;
    await entry.lock.inLock(async () => {
      woke = await this.wakeEntryIfSleeping(entry);
      entry.inbox.post(item, completion);
    });
    if (woke) {
      await this.signalLifecycle(entry.agentId, "wake");
    }
  }

  private async wakeEntryIfSleeping(entry: AgentEntry): Promise<boolean> {
    if (entry.agent.state.state !== "sleeping") {
      return false;
    }
    await this.cancelIdleSignal(entry.agentId);
    entry.agent.state.state = "active";
    await agentStateWrite(this.config.current, entry.agentId, entry.agent.state);
    this.eventBus.emit("agent.woke", { agentId: entry.agentId });
    logger.debug({ agentId: entry.agentId }, "Agent woke from sleep");
    return true;
  }

  private async scheduleIdleSignal(agentId: string): Promise<void> {
    if (!this.delayedSignals) {
      return;
    }
    const deliverAt = Date.now() + AGENT_IDLE_DELAY_MS;
    const type = lifecycleSignalTypeBuild(agentId, "idle");
    try {
      await this.delayedSignals.schedule({
        type,
        deliverAt,
        source: { type: "agent", id: agentId },
        data: { agentId, state: "idle" },
        repeatKey: AGENT_IDLE_REPEAT_KEY
      });
    } catch (error) {
      logger.warn({ agentId, error }, "Failed to schedule idle lifecycle signal");
    }
  }

  private async cancelIdleSignal(agentId: string): Promise<void> {
    if (!this.delayedSignals) {
      return;
    }
    try {
      await this.delayedSignals.cancelByRepeatKey({
        type: lifecycleSignalTypeBuild(agentId, "idle"),
        repeatKey: AGENT_IDLE_REPEAT_KEY
      });
    } catch (error) {
      logger.warn({ agentId, error }, "Failed to cancel idle lifecycle signal");
    }
  }

  private async signalLifecycle(agentId: string, state: "wake" | "sleep"): Promise<void> {
    if (!this._signals) {
      return;
    }
    try {
      await this._signals.generate({
        type: lifecycleSignalTypeBuild(agentId, state),
        source: { type: "agent", id: agentId },
        data: { agentId, state }
      });
    } catch (error) {
      logger.warn({ agentId, state, error }, "Failed to emit lifecycle signal");
    }
  }

  private async restoreAgent(
    agentId: string,
    options?: { allowSleeping?: boolean }
  ): Promise<AgentEntry | null> {
    let descriptor: AgentDescriptor | null = null;
    let state: Awaited<ReturnType<typeof agentStateRead>> = null;
    try {
      descriptor = await agentDescriptorRead(this.config.current, agentId);
      state = await agentStateRead(this.config.current, agentId);
    } catch (error) {
      logger.warn({ agentId, error }, "Agent restore failed due to invalid persisted data");
      return null;
    }
    if (!descriptor || !state) {
      return null;
    }
    if (state.state === "sleeping" && !options?.allowSleeping) {
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

function lifecycleSignalTypeBuild(agentId: string, state: "wake" | "sleep" | "idle"): string {
  return `agent:${agentId}:${state}`;
}
