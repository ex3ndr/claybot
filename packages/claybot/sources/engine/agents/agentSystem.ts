import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";

import { createId } from "@paralleldrive/cuid2";

import { getLogger } from "../../log.js";
import type { FileStore } from "../../files/store.js";
import type { AuthStore } from "../../auth/store.js";
import type {
  AgentRuntime,
  Config,
  ConnectorMessage,
  MessageContext,
  PermissionDecision
} from "@/types";
import { cuid2Is } from "../../utils/cuid2Is.js";
import type { ConnectorRegistry } from "../modules/connectorRegistry.js";
import type { ImageGenerationRegistry } from "../modules/imageGenerationRegistry.js";
import type { ToolResolver } from "../modules/toolResolver.js";
import { messageBuildSystemText } from "../messages/messageBuildSystemText.js";
import type { PluginManager } from "../plugins/manager.js";
import type { EngineEventBus } from "../ipc/events.js";
import type { InferenceRouter } from "../modules/inference/router.js";
import type { Crons } from "../cron/crons.js";
import { Agent } from "./agent.js";
import { AgentInbox } from "./ops/agentInbox.js";
import type {
  AgentInboxItem,
  AgentInboxResult,
  AgentHistoryRecord,
  AgentPostTarget,
  BackgroundAgentState
} from "./ops/agentTypes.js";
import type { AgentDescriptor, AgentFetchStrategy } from "./ops/agentDescriptorTypes.js";
import { agentDescriptorBuild } from "./ops/agentDescriptorBuild.js";
import { agentDescriptorMatchesStrategy } from "./ops/agentDescriptorMatchesStrategy.js";
import { agentKeyBuild } from "./ops/agentKeyBuild.js";
import { agentKeyResolve } from "./ops/agentKeyResolve.js";
import { agentTimestampGet } from "./ops/agentTimestampGet.js";
import { agentDescriptorRead } from "./ops/agentDescriptorRead.js";
import { agentHistoryLoad } from "./ops/agentHistoryLoad.js";
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
  crons: Crons;
  agentRuntime: AgentRuntime;
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
  readonly crons: Crons;
  readonly agentRuntime: AgentRuntime;
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
    this.crons = options.crons;
    this.agentRuntime = options.agentRuntime;
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

  async scheduleMessage(
    source: string,
    message: ConnectorMessage,
    context: MessageContext
  ): Promise<void> {
    if (this.stage === "idle") {
      logger.warn(
        { source, channelId: context.channelId },
        "AgentSystem received message before load"
      );
    }

    const agentId = this.resolveAgentIdForMessage(source, context);
    await this.post(
      { agentId },
      {
        type: "message",
        source,
        message,
        context
      }
    );
  }

  async schedulePermissionDecision(
    source: string,
    decision: PermissionDecision,
    context: MessageContext
  ): Promise<void> {
    const agentId = this.resolveAgentIdForMessage(source, context);
    await this.post(
      { agentId },
      {
        type: "permission",
        source,
        decision,
        context
      }
    );
  }

  async post(target: AgentPostTarget, item: AgentInboxItem): Promise<void> {
    const entry = await this.resolveEntry(target, item);
    entry.inbox.post(item);
    this.startEntryIfRunning(entry);
  }

  async postAndWait(
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

  getBackgroundAgents(): BackgroundAgentState[] {
    return Array.from(this.entries.values())
      .filter((entry) => entry.agent.state.agent?.kind === "background")
      .map((entry) => {
        const pending = entry.inbox.size();
        const processing = entry.agent.isProcessing();
        const status = processing ? "running" : pending > 0 ? "queued" : "idle";
        const agentState = entry.agent.state.agent;
        return {
          agentId: entry.agentId,
          name: agentState?.name ?? null,
          parentAgentId: agentState?.parentAgentId ?? null,
          status,
          pending,
          updatedAt: entry.agent.state.updatedAt
        };
      });
  }

  listAgents(): Array<{ agentId: string; descriptor: AgentDescriptor; updatedAt: number }> {
    return Array.from(this.entries.values()).map((entry) => ({
      agentId: entry.agentId,
      descriptor: entry.descriptor,
      updatedAt: entry.agent.state.updatedAt
    }));
  }

  async loadHistory(agentId: string): Promise<AgentHistoryRecord[]> {
    return agentHistoryLoad(this.config, agentId);
  }

  getAgentById(agentId: string): Agent | null {
    return this.entries.get(agentId)?.agent ?? null;
  }

  resetAgent(agentId: string): boolean {
    const entry = this.entries.get(agentId);
    if (!entry) {
      return false;
    }
    entry.inbox.post({ type: "reset", source: "system" });
    this.startEntryIfRunning(entry);
    return true;
  }

  async startBackgroundAgent(args: {
    prompt: string;
    agentId?: string;
    name?: string;
    parentAgentId: string;
  }): Promise<{ agentId: string }> {
    const prompt = args.prompt.trim();
    if (!prompt) {
      throw new Error("Background agent prompt is required");
    }
    const agentParent = args.parentAgentId;
    if (!agentParent) {
      throw new Error("Subagent parent agent is required");
    }
    const agentName = args.name ?? "subagent";
    const agentId = cuid2Is(args.agentId ?? null) ? args.agentId! : createId();
    const parentContext = this.entries.get(agentParent)?.agent.state.routing?.context ?? null;
    const baseContext: MessageContext = parentContext
      ? { ...parentContext, messageId: undefined }
      : { channelId: "background", userId: "system" };
    const descriptor: AgentDescriptor = {
      type: "subagent",
      id: agentId,
      parentAgentId: agentParent,
      name: agentName
    };
    const message: ConnectorMessage = { text: prompt };
    const startPromise = this.post(
      { descriptor },
      { type: "message", source: "system", message, context: baseContext }
    );
    startPromise.catch((error) => {
      logger.warn({ agentId, error }, "Background agent start failed");
    });
    return { agentId };
  }

  async sendAgentMessage(args: {
    agentId?: string;
    text: string;
    origin?: "background" | "system";
  }): Promise<void> {
    const targetAgentId = args.agentId ?? this.resolveAgentId("most-recent-foreground");
    if (!targetAgentId) {
      throw new Error("No recent foreground agent found.");
    }
    const agent = this.getAgentById(targetAgentId);
    if (!agent) {
      throw new Error(`Agent not found: ${targetAgentId}`);
    }
    const routing = agent.state.routing;
    if (!routing) {
      throw new Error(`Agent routing unavailable: ${targetAgentId}`);
    }
    const source = routing.source;
    if (!this.connectorRegistry.get(source)) {
      throw new Error(`Connector unavailable for agent: ${source}`);
    }
    const context = { ...routing.context, messageId: undefined };
    const message: ConnectorMessage = {
      text: messageBuildSystemText(args.text, args.origin)
    };
    await this.scheduleMessage(source, message, context);
  }

  resolveAgentId(strategy: AgentFetchStrategy): string | null {
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

  private resolveAgentIdForMessage(source: string, context: MessageContext): string {
    const key = agentKeyResolve(source, context, logger);
    if (key) {
      return this.getOrCreateAgentId(key);
    }
    if (source && source !== "system" && source !== "cron" && source !== "background") {
      throw new Error("userId is required to map agents for connectors.");
    }
    return createId();
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
      if (item.type !== "message") {
        throw new Error(`Agent not found: ${target.agentId}`);
      }
      const descriptor = agentDescriptorBuild(item.source, item.context, target.agentId);
      const inbox = new AgentInbox(target.agentId);
      const agent = await Agent.create(target.agentId, descriptor, inbox, this, {
        source: item.source,
        context: item.context
      });
      const entry = this.registerEntry({
        agentId: target.agentId,
        descriptor,
        agent,
        inbox
      });
      return entry;
    }

    const descriptor = target.descriptor;
    const key = agentKeyBuild(descriptor);
    if (key) {
      const agentId = this.keyMap.get(key);
      if (agentId) {
        const existing = this.entries.get(agentId);
        if (existing) {
          return existing;
        }
      }
    }

    if (descriptor.type === "subagent" && cuid2Is(descriptor.id)) {
      const existing = this.entries.get(descriptor.id);
      if (existing) {
        return existing;
      }
    }

    if (descriptor.type === "cron" && cuid2Is(descriptor.id)) {
      const existing = this.entries.get(descriptor.id);
      if (existing) {
        return existing;
      }
    }

    const agentId =
      (descriptor.type === "subagent" || descriptor.type === "cron") &&
        cuid2Is(descriptor.id)
        ? descriptor.id
        : createId();
    const inbox = new AgentInbox(agentId);
    const agent = await Agent.create(agentId, descriptor, inbox, this, {
      source: item.type === "message" ? item.source : "agent",
      context: item.type === "message" ? item.context : undefined
    });
    const entry = this.registerEntry({
      agentId,
      descriptor,
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
    const key = agentKeyBuild(input.descriptor);
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

  private getOrCreateAgentId(key: string): string {
    const existing = this.keyMap.get(key);
    if (existing) {
      return existing;
    }
    const id = createId();
    this.keyMap.set(key, id);
    return id;
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
