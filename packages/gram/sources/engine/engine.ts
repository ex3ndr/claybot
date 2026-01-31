import { createId } from "@paralleldrive/cuid2";
import type { Context, ToolCall } from "@mariozechner/pi-ai";
import { promises as fs } from "node:fs";
import path from "node:path";

import { getLogger } from "../log.js";
import {
  ConnectorRegistry,
  ImageGenerationRegistry,
  InferenceRegistry,
  ToolResolver
} from "./modules.js";
import type {
  Connector,
  ConnectorMessage,
  MessageContext,
  PermissionAccess,
  PermissionDecision
} from "./connectors/types.js";
import { FileStore } from "../files/store.js";
import type { FileReference } from "../files/types.js";
import { InferenceRouter } from "./inference/router.js";
import { PluginRegistry } from "./plugins/registry.js";
import { PluginEventEngine } from "./plugins/event-engine.js";
import { PluginEventQueue } from "./plugins/events.js";
import { PluginManager } from "./plugins/manager.js";
import { buildPluginCatalog } from "./plugins/catalog.js";
import type { SettingsConfig } from "../settings.js";
import {
  ensureWorkspaceDir,
  normalizePermissions,
  resolveWorkspaceDir,
  type SessionPermissions
} from "./permissions.js";
import { assumeWorkspace, createSystemPrompt } from "./createSystemPrompt.js";
import { getProviderDefinition, listActiveInferenceProviders } from "../providers/catalog.js";
import { SessionManager } from "./sessions/manager.js";
import { SessionStore } from "./sessions/store.js";
import { Session } from "./sessions/session.js";
import type { SessionMessage } from "./sessions/types.js";
import { AuthStore } from "../auth/store.js";
import {
  buildCronDeleteTaskTool,
  buildCronReadTaskTool,
  buildCronReadMemoryTool,
  buildCronTool,
  buildCronWriteMemoryTool
} from "./tools/cron.js";
import { buildImageGenerationTool } from "./tools/image-generation.js";
import { buildReactionTool } from "./tools/reaction.js";
import { buildPermissionRequestTool } from "./tools/permissions.js";
import { buildSendFileTool } from "./tools/send-file.js";
import { buildRunHeartbeatTool } from "./tools/heartbeat.js";
import { buildSendSessionMessageTool, buildStartBackgroundAgentTool } from "./tools/background.js";
import { formatTimeAI } from "../util/timeFormat.js";
import type { AgentRuntime, ToolExecutionResult } from "./tools/types.js";
import { CronScheduler } from "./cron.js";
import { CronStore } from "./cron-store.js";
import { HeartbeatScheduler } from "./heartbeat.js";
import { HeartbeatStore } from "./heartbeat-store.js";
import { EngineEventBus } from "./ipc/events.js";
import { ProviderManager } from "../providers/manager.js";
import { DEFAULT_SOUL_PATH, DEFAULT_USER_PATH } from "../paths.js";

const logger = getLogger("engine.runtime");
const MAX_TOOL_ITERATIONS = 5;
const BACKGROUND_TOOL_DENYLIST = new Set([
  "request_permission",
  "set_reaction",
  "send_file"
]);

type SessionState = {
  context: Context;
  providerId?: string;
  permissions: SessionPermissions;
  routing?: {
    source: string;
    context: MessageContext;
  };
  agent?: {
    kind: "background";
    parentSessionId?: string;
    name?: string;
  };
};

export type EngineOptions = {
  settings: SettingsConfig;
  dataDir: string;
  authPath: string;
  eventBus: EngineEventBus;
  configDir: string;
};

export class Engine {
  private settings: SettingsConfig;
  private dataDir: string;
  private configDir: string;
  private workspaceDir: string;
  private defaultPermissions: SessionPermissions;
  private authStore: AuthStore;
  private fileStore: FileStore;
  private connectorRegistry: ConnectorRegistry;
  private inferenceRegistry: InferenceRegistry;
  private imageRegistry: ImageGenerationRegistry;
  private toolResolver: ToolResolver;
  private pluginRegistry: PluginRegistry;
  private pluginManager: PluginManager;
  private pluginEventQueue: PluginEventQueue;
  private pluginEventEngine: PluginEventEngine;
  private providerManager: ProviderManager;
  private sessionStore: SessionStore<SessionState>;
  private sessionManager: SessionManager<SessionState>;
  private cron: CronScheduler | null = null;
  private cronStore: CronStore | null = null;
  private heartbeat: HeartbeatScheduler | null = null;
  private heartbeatStore: HeartbeatStore | null = null;
  private inferenceRouter: InferenceRouter;
  private eventBus: EngineEventBus;
  private sessionKeyMap = new Map<string, string>();

  constructor(options: EngineOptions) {
    logger.debug(`Engine constructor starting, dataDir=${options.dataDir}`);
    this.settings = options.settings;
    this.dataDir = options.dataDir;
    this.configDir = options.configDir;
    this.workspaceDir = resolveWorkspaceDir(this.configDir, this.settings.assistant ?? null);
    this.defaultPermissions = buildDefaultPermissions(this.workspaceDir);
    this.eventBus = options.eventBus;
    this.authStore = new AuthStore(options.authPath);
    this.fileStore = new FileStore({ basePath: `${this.dataDir}/files` });
    logger.debug(`AuthStore and FileStore initialized`);

    this.pluginEventQueue = new PluginEventQueue();
    this.pluginEventEngine = new PluginEventEngine(this.pluginEventQueue);

    this.connectorRegistry = new ConnectorRegistry({
      onMessage: (source, message, context) => {
        if (!context.channelId || !context.userId) {
          logger.error(
            { source, channelId: context.channelId, userId: context.userId },
            "Connector message missing channelId or userId"
          );
          return;
        }
        const providerId = this.resolveProviderId(context);
        const messageContext =
          providerId && context.providerId !== providerId
            ? { ...context, providerId }
            : context;
        logger.debug(`Connector message received: source=${source} channel=${messageContext.channelId} text=${message.text?.length ?? 0}chars files=${message.files?.length ?? 0}`);
        this.pluginEventQueue.emit(
          { pluginId: source, instanceId: source },
          { type: "connector.message", payload: { source, message, context: messageContext } }
        );
        logger.debug(`Connector message emitted to event queue: source=${source}`);
      },
      onPermission: (source, decision, context) => {
        void this.handlePermissionDecision(source, decision, context);
      },
      onFatal: (source, reason, error) => {
        logger.warn({ source, reason, error }, "Connector requested shutdown");
      }
    });

    this.inferenceRegistry = new InferenceRegistry();
    this.imageRegistry = new ImageGenerationRegistry();
    this.toolResolver = new ToolResolver();
    this.inferenceRouter = new InferenceRouter({
      providers: listActiveInferenceProviders(this.settings),
      registry: this.inferenceRegistry,
      auth: this.authStore
    });

    this.pluginRegistry = new PluginRegistry(
      this.connectorRegistry,
      this.inferenceRegistry,
      this.imageRegistry,
      this.toolResolver
    );

    this.pluginManager = new PluginManager({
      settings: this.settings,
      registry: this.pluginRegistry,
      auth: this.authStore,
      fileStore: this.fileStore,
      pluginCatalog: buildPluginCatalog(),
      dataDir: this.dataDir,
      eventQueue: this.pluginEventQueue,
      inferenceRouter: this.inferenceRouter,
      engineEvents: this.eventBus
    });

    this.providerManager = new ProviderManager({
      settings: this.settings,
      auth: this.authStore,
      fileStore: this.fileStore,
      inferenceRegistry: this.inferenceRegistry,
      imageRegistry: this.imageRegistry
    });

    this.sessionStore = new SessionStore<SessionState>({
      basePath: `${this.dataDir}/sessions`
    });

    this.sessionManager = new SessionManager<SessionState>({
      createState: () => ({
        context: { messages: [] },
        providerId: undefined,
        permissions: { ...this.defaultPermissions }
      }),
      sessionIdFor: (source, context) => {
        if (context.sessionId) {
          const key = this.buildSessionKey(source, context);
          if (key) {
            this.sessionKeyMap.set(key, context.sessionId);
          }
          return context.sessionId;
        }
        const key = this.buildSessionKey(source, context);
        if (!key) {
          throw new Error("userId is required to map sessions for connectors.");
        }
        return this.getOrCreateSessionId(key);
      },
      storageIdFactory: () => this.sessionStore.createStorageId(),
      messageTransform: (message, context, receivedAt) => {
        return formatIncomingMessage(message, context, receivedAt);
      },
      onSessionCreated: (session, source, context) => {
        this.captureRouting(session, source, context);
        this.captureAgent(session, context);
        const providerId = this.resolveProviderId(context);
        if (providerId) {
          session.context.state.providerId = providerId;
        }
        if (context.cron?.filesPath) {
          session.context.state.permissions = normalizePermissions(
            { workingDir: context.cron.filesPath },
            this.defaultPermissions.workingDir
          );
          ensureDefaultFilePermissions(session.context.state.permissions);
        }
        logger.info(
          {
            sessionId: session.id,
            source,
            channelId: context.channelId,
            userId: context.userId
          },
          "Session created"
        );
        void this.sessionStore
          .recordSessionCreated(session, source, context)
          .catch((error) => {
            logger.warn({ sessionId: session.id, source, error }, "Session persistence failed");
          });
        this.eventBus.emit("session.created", {
          sessionId: session.id,
          source,
          context
        });
      },
      onSessionUpdated: (session, entry, source) => {
        this.captureRouting(session, source, entry.context);
        this.captureAgent(session, entry.context);
        logger.info(
          {
            sessionId: session.id,
            source,
            messageId: entry.id,
            pending: session.size
          },
          "Session updated"
        );
        void this.sessionStore.recordIncoming(session, entry, source).catch((error) => {
          logger.warn(
            { sessionId: session.id, source, messageId: entry.id, error },
            "Session persistence failed"
          );
        });
        this.eventBus.emit("session.updated", {
          sessionId: session.id,
          source,
          messageId: entry.id,
          entry: {
            id: entry.id,
            message: entry.message,
            context: entry.context,
            receivedAt: entry.receivedAt
          }
        });
      },
      onMessageStart: (session, entry, source) => {
        logger.info({ sessionId: session.id, source, messageId: entry.id }, "Session processing started");
      },
      onMessageEnd: (session, entry, source) => {
        logger.info({ sessionId: session.id, source, messageId: entry.id }, "Session processing completed");
      },
      onError: (error, session, entry) => {
        logger.warn({ sessionId: session.id, messageId: entry.id, error }, "Session handler failed");
      }
    });

    this.pluginEventEngine.register("connector.message", async (event) => {
      logger.debug(`Handling connector.message event`);
      const payload = event.payload as {
        source: string;
        message: ConnectorMessage;
        context: MessageContext;
      };
      if (!payload) {
        logger.debug(`connector.message event has no payload, skipping`);
        return;
      }
      const messageContext = this.withProviderContext(payload.context);
      logger.debug(`Dispatching to session manager: source=${payload.source} channel=${messageContext.channelId}`);
      await this.sessionManager.handleMessage(
        payload.source,
        payload.message,
        messageContext,
        (session, entry) => this.handleSessionMessage(entry, session, payload.source)
      );
      logger.debug(`Session manager completed: source=${payload.source}`);
    });

  }

  async start(): Promise<void> {
    logger.debug("Engine.start() beginning");
    await ensureWorkspaceDir(this.workspaceDir);
    logger.debug("Syncing provider manager with settings");
    await this.providerManager.sync(this.settings);
    logger.debug("Provider manager sync complete");
    logger.debug("Loading enabled plugins");
    await this.pluginManager.loadEnabled(this.settings);
    logger.debug("Plugins loaded, starting plugin event engine");
    this.pluginEventEngine.start();
    logger.debug("Plugin event engine started");

    const cronPath = path.join(this.configDir, "cron");
    logger.debug(`Initializing CronScheduler cronPath=${cronPath}`);
    this.cronStore = new CronStore(cronPath);
    await this.cronStore.ensureDir();
    this.cron = new CronScheduler({
      store: this.cronStore,
      onTask: (task, context) => {
        const messageContext = this.withProviderContext({
          ...context,
          cron: {
            taskId: task.taskId,
            taskName: task.taskName,
            memoryPath: task.memoryPath,
            filesPath: task.filesPath
          }
        });
        logger.debug(`CronScheduler.onTask triggered channelId=${messageContext.channelId} sessionId=${messageContext.sessionId}`);
        void this.startBackgroundAgent({
          prompt: task.prompt,
          sessionId: messageContext.sessionId,
          name: task.taskName,
          context: {
            userId: "cron",
            cron: messageContext.cron,
            providerId: messageContext.providerId,
            channelType: messageContext.channelType,
            channelId: messageContext.channelId
          }
        });
      },
      onError: (error, taskId) => {
        logger.warn({ taskId, error }, "Cron task failed");
      }
    });

    const heartbeatPath = path.join(this.configDir, "heartbeat");
    logger.debug(`Initializing HeartbeatScheduler heartbeatPath=${heartbeatPath}`);
    this.heartbeatStore = new HeartbeatStore(heartbeatPath);
    await this.heartbeatStore.ensureDir();
    this.heartbeat = new HeartbeatScheduler({
      store: this.heartbeatStore,
      intervalMs: 30 * 60 * 1000,
      onTask: async (task) => {
        await this.startBackgroundAgent({
          prompt: task.prompt,
          sessionId: `heartbeat:${task.id}`,
          name: task.title
        });
      },
      onError: (error, taskId) => {
        logger.warn({ taskId, error }, "Heartbeat task failed");
      }
    });

    logger.debug("Registering core tools");
    this.toolResolver.register(
      "core",
      buildCronTool(this.cron, (task) => {
        logger.debug(`Cron task added via tool taskId=${task.id}`);
        this.eventBus.emit("cron.task.added", { task });
      })
    );
    if (this.cronStore) {
      this.toolResolver.register("core", buildCronReadTaskTool(this.cronStore));
      this.toolResolver.register("core", buildCronReadMemoryTool(this.cronStore));
      this.toolResolver.register("core", buildCronWriteMemoryTool(this.cronStore));
    }
    this.toolResolver.register("core", buildCronDeleteTaskTool(this.cron));
    this.toolResolver.register("core", buildRunHeartbeatTool());
    this.toolResolver.register("core", buildStartBackgroundAgentTool());
    this.toolResolver.register("core", buildSendSessionMessageTool());
    this.toolResolver.register("core", buildImageGenerationTool(this.imageRegistry));
    this.toolResolver.register("core", buildReactionTool());
    this.toolResolver.register("core", buildSendFileTool());
    this.toolResolver.register("core", buildPermissionRequestTool());
    logger.debug(
      "Core tools registered: cron, cron_memory, heartbeat, background, image_generation, reaction, send_file, request_permission"
    );

    logger.debug("Restoring sessions from disk");
    await this.restoreSessions();
    logger.debug("Sessions restored");

    logger.debug("Starting cron scheduler");
    await this.cron.start();
    this.eventBus.emit("cron.started", { tasks: this.cron.listTasks() });
    if (this.heartbeat) {
      logger.debug("Starting heartbeat scheduler");
      await this.heartbeat.start();
    }
    logger.debug("Engine.start() complete");
  }

  async shutdown(): Promise<void> {
    await this.connectorRegistry.unregisterAll("shutdown");
    if (this.cron) {
      this.cron.stop();
    }
    if (this.heartbeat) {
      this.heartbeat.stop();
    }
    this.pluginEventEngine.stop();
    await this.pluginManager.unloadAll();
  }

  getStatus() {
    const plugins = this.pluginManager.listLoadedDetails();
    const pluginByInstance = new Map(plugins.map((plugin) => [plugin.id, plugin]));

    return {
      plugins,
      providers: this.providerManager.listLoadedDetails(),
      connectors: this.connectorRegistry.listStatus().map((connector) => {
        const plugin = pluginByInstance.get(connector.id);
        return {
          id: connector.id,
          name: plugin?.name ?? connector.id,
          pluginId: plugin?.pluginId,
          loadedAt: connector.loadedAt
        };
      }),
      inferenceProviders: this.inferenceRegistry.list().map((provider) => {
        const definition = getProviderDefinition(provider.id);
        return {
          id: provider.id,
          name: provider.label ?? definition?.name ?? provider.id,
          label: provider.label
        };
      }),
      imageProviders: this.imageRegistry.list().map((provider) => {
        const definition = getProviderDefinition(provider.id);
        return {
          id: provider.id,
          name: provider.label ?? definition?.name ?? provider.id,
          label: provider.label
        };
      }),
      tools: this.listContextTools().map((tool) => tool.name)
    };
  }

  getCronTasks() {
    return this.cron?.listTasks() ?? [];
  }

  getSessionStore(): SessionStore<SessionState> {
    return this.sessionStore;
  }

  resetSessionByStorageId(storageId: string): boolean {
    const session = this.sessionManager.getByStorageId(storageId);
    if (!session) {
      return false;
    }
    session.resetContext(new Date());
    void this.sessionStore.recordState(session).catch((error) => {
      logger.warn({ sessionId: session.id, error }, "Session reset persistence failed");
    });
    this.eventBus.emit("session.reset", {
      sessionId: session.id,
      source: "system",
      context: { channelId: session.id, userId: "system", sessionId: session.id }
    });
    return true;
  }

  resetSession(sessionId: string): boolean {
    const ok = this.sessionManager.resetSession(sessionId);
    if (!ok) {
      return false;
    }
    const session = this.sessionManager.getById(sessionId);
    if (!session) {
      return false;
    }
    void this.sessionStore.recordState(session).catch((error) => {
      logger.warn({ sessionId: session.id, error }, "Session reset persistence failed");
    });
    this.eventBus.emit("session.reset", {
      sessionId: session.id,
      source: "system",
      context: { channelId: session.id, userId: "system", sessionId }
    });
    return true;
  }

  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  getSettings(): SettingsConfig {
    return this.settings;
  }

  getAuthStore(): AuthStore {
    return this.authStore;
  }

  getFileStore(): FileStore {
    return this.fileStore;
  }

  getConnectorRegistry(): ConnectorRegistry {
    return this.connectorRegistry;
  }

  getInferenceRouter(): InferenceRouter {
    return this.inferenceRouter;
  }

  private listContextTools(
    source?: string,
    options?: { agentKind?: "background" | "foreground"; allowCronTools?: boolean }
  ) {
    let tools = this.toolResolver.listTools();
    if (source && source !== "cron" && !options?.allowCronTools) {
      tools = tools.filter(
        (tool) => tool.name !== "cron_read_memory" && tool.name !== "cron_write_memory"
      );
    }
    if (options?.agentKind === "background") {
      tools = tools.filter((tool) => !BACKGROUND_TOOL_DENYLIST.has(tool.name));
    }
    const connectorCapabilities = source
      ? this.connectorRegistry.get(source)?.capabilities ?? null
      : null;
    const supportsFiles = source
      ? (connectorCapabilities?.sendFiles?.modes.length ?? 0) > 0
      : this.connectorRegistry
          .list()
          .some(
            (id) =>
              (this.connectorRegistry.get(id)?.capabilities.sendFiles?.modes.length ?? 0) > 0
          );
    const supportsReactions = source
      ? connectorCapabilities?.reactions === true
      : this.connectorRegistry
          .list()
          .some((id) => this.connectorRegistry.get(id)?.capabilities.reactions === true);
    if (this.imageRegistry.list().length === 0) {
      const filtered = tools.filter((tool) => tool.name !== "generate_image");
      return filterConnectorTools(filtered, supportsFiles, supportsReactions);
    }
    return filterConnectorTools(tools, supportsFiles, supportsReactions);
  }

  private async handleSlashCommand(
    command: ResolvedCommand,
    entry: SessionMessage,
    session: Session<SessionState>,
    source: string,
    connector: Connector
  ): Promise<boolean> {
    const name = command.name.toLowerCase();
    if (name !== "reset" && name !== "compact") {
      return false;
    }

    if (name === "reset") {
      const ok = this.resetSession(session.id);
      const message = ok ? "Session reset." : "Failed to reset session.";
      await this.replyToCommand(connector, entry, session, source, message);
      return true;
    }

    const result = await this.compactSession(session, entry, source);
    await this.replyToCommand(
      connector,
      entry,
      session,
      source,
      result.ok ? "Compaction complete." : `Compaction failed: ${result.error}`
    );
    return true;
  }

  private async replyToCommand(
    connector: Connector,
    entry: SessionMessage,
    session: Session<SessionState>,
    source: string,
    text: string
  ): Promise<void> {
    try {
      await connector.sendMessage(entry.context.channelId, {
        text,
        replyToMessageId: entry.context.messageId
      });
      await recordOutgoingEntry(this.sessionStore, session, source, entry.context, text);
    } catch (error) {
      logger.warn({ connector: source, error }, "Failed to send command reply");
    } finally {
      await recordSessionState(this.sessionStore, session, source);
    }
  }

  private async compactSession(
    session: Session<SessionState>,
    entry: SessionMessage,
    source: string
  ): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
    const history = session.context.state.context.messages;
    if (!history || history.length === 0) {
      return { ok: false, error: "No conversation history to compact." };
    }

    const providerId = this.resolveSessionProvider(session, entry.context);
    const providersForSession = providerId
      ? listActiveInferenceProviders(this.settings).filter((provider) => provider.id === providerId)
      : [];

    const compactContext: Context = {
      messages: [
        ...history,
        {
          role: "user",
          content:
            "Summarize the conversation so far for future context. " +
            "Include key facts, decisions, tasks, preferences, and any important identifiers. " +
            "Be concise and factual.",
          timestamp: Date.now()
        }
      ],
      tools: [],
      systemPrompt:
        "You are a compaction assistant. Return a concise summary of the conversation for reuse."
    };

    try {
      const result = await this.inferenceRouter.complete(compactContext, session.id, {
        providersOverride: providersForSession
      });
      const summary = extractAssistantText(result.message);
      if (!summary || summary.trim().length === 0) {
        return { ok: false, error: "No summary produced." };
      }
      session.context.state.context.messages = [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `Conversation summary:\n${summary.trim()}`
            }
          ],
          api: "compaction",
          provider: "system",
          model: "summary",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0
            }
          },
          stopReason: "stop",
          timestamp: Date.now()
        }
      ];
      await recordSessionState(this.sessionStore, session, source);
      return { ok: true, summary };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    messageContext?: MessageContext
  ): Promise<ToolExecutionResult> {
    const toolCall: ToolCall = {
      id: createId(),
      name,
      type: "toolCall",
      arguments: args
    };
    const now = new Date();
    const sessionId = messageContext?.sessionId ?? `system:${name}`;
    const session = new Session<SessionState>(
      sessionId,
      {
        id: sessionId,
        createdAt: now,
        updatedAt: now,
        state: {
          context: { messages: [] },
          providerId: undefined,
          permissions: { ...this.defaultPermissions }
        }
      },
      createId()
    );
    const context: MessageContext =
      messageContext ?? {
        channelId: sessionId,
        userId: "system",
        sessionId
      };

    return this.toolResolver.execute(toolCall, {
      connectorRegistry: this.connectorRegistry,
      fileStore: this.fileStore,
      auth: this.authStore,
      logger,
      assistant: this.settings.assistant ?? null,
      permissions: session.context.state.permissions,
      session,
      source: "system",
      messageContext: context,
      agentRuntime: this.buildAgentRuntime()
    });
  }

  private buildAgentRuntime(): AgentRuntime {
    return {
      startBackgroundAgent: (args) => this.startBackgroundAgent(args),
      sendSessionMessage: (args) => this.sendSessionMessage(args),
      runHeartbeatNow: (args) => this.runHeartbeatNow(args)
    };
  }

  private async startBackgroundAgent(args: {
    prompt: string;
    sessionId?: string;
    name?: string;
    parentSessionId?: string;
    context?: Partial<MessageContext>;
  }): Promise<{ sessionId: string }> {
    const prompt = args.prompt.trim();
    if (!prompt) {
      throw new Error("Background agent prompt is required");
    }
    const sessionId = args.sessionId ?? `background:${createId()}`;
    const agentContext = {
      kind: "background" as const,
      parentSessionId: args.parentSessionId ?? args.context?.agent?.parentSessionId,
      name: args.name ?? args.context?.agent?.name
    };
    const messageContext: MessageContext = {
      channelId: sessionId,
      userId: "system",
      sessionId,
      agent: agentContext,
      ...(args.context ?? {})
    };
    messageContext.channelId = sessionId;
    messageContext.sessionId = sessionId;
    messageContext.agent = { ...agentContext, ...(args.context?.agent ?? {}) };
    const message: ConnectorMessage = { text: prompt };
    await this.sessionManager.handleMessage(
      "system",
      message,
      messageContext,
      (session, entry) => this.handleSessionMessage(entry, session, "system")
    );
    return { sessionId };
  }

  private async sendSessionMessage(args: {
    sessionId?: string;
    text: string;
    origin?: "background" | "system";
  }): Promise<void> {
    const targetSessionId = args.sessionId ?? await this.findMostRecentHumanSessionId();
    if (!targetSessionId) {
      throw new Error("No recent DM session with a human found.");
    }
    const session = this.sessionManager.getById(targetSessionId);
    if (!session) {
      throw new Error(`Session not found: ${targetSessionId}`);
    }
    const routing = session.context.state.routing;
    if (!routing) {
      throw new Error(`Session routing unavailable: ${targetSessionId}`);
    }
    const source = routing.source;
    if (!this.connectorRegistry.get(source)) {
      throw new Error(`Connector unavailable for session: ${source}`);
    }
    const context = { ...routing.context, messageId: undefined, commands: undefined };
    const message: ConnectorMessage = {
      text: buildSystemMessageText(args.text, args.origin)
    };
    await this.sessionManager.handleMessage(
      source,
      message,
      context,
      (sessionToHandle, entry) => this.handleSessionMessage(entry, sessionToHandle, source)
    );
  }

  private async findMostRecentHumanSessionId(): Promise<string | null> {
    const sessions = await this.sessionStore.listSessions();
    const candidates = sessions.filter((session) =>
      isHumanDmSession(session.source, session.context)
    );
    if (candidates.length === 0) {
      return null;
    }
    candidates.sort((a, b) => {
      const aTime = getSessionTimestamp(a.updatedAt ?? a.createdAt);
      const bTime = getSessionTimestamp(b.updatedAt ?? b.createdAt);
      return bTime - aTime;
    });
    return candidates[0]?.sessionId ?? null;
  }

  private async runHeartbeatNow(args?: { ids?: string[] }): Promise<{ ran: number; taskIds: string[] }> {
    if (!this.heartbeat) {
      throw new Error("Heartbeat scheduler unavailable");
    }
    return this.heartbeat.runNow(args?.ids);
  }


  async updateSettings(settings: SettingsConfig): Promise<void> {
    this.settings = settings;
    this.workspaceDir = resolveWorkspaceDir(this.configDir, this.settings.assistant ?? null);
    this.defaultPermissions = buildDefaultPermissions(this.workspaceDir);
    await ensureWorkspaceDir(this.workspaceDir);
    await this.providerManager.sync(settings);
    await this.pluginManager.syncWithSettings(settings);
    this.inferenceRouter.updateProviders(listActiveInferenceProviders(settings));
  }

  private withProviderContext(context: MessageContext): MessageContext {
    const providerId = this.resolveProviderId(context);
    if (!providerId || context.providerId === providerId) {
      return context;
    }
    return { ...context, providerId };
  }

  private resolveProviderId(context: MessageContext): string | undefined {
    if (context.providerId) {
      return context.providerId;
    }
    const providers = listActiveInferenceProviders(this.settings);
    return providers[0]?.id;
  }

  private captureRouting(
    session: Session<SessionState>,
    source: string,
    context: MessageContext
  ): void {
    session.context.state.routing = {
      source,
      context: sanitizeRoutingContext(context)
    };
  }

  private captureAgent(
    session: Session<SessionState>,
    context: MessageContext
  ): void {
    if (context.agent?.kind === "background") {
      session.context.state.agent = {
        kind: "background",
        parentSessionId: context.agent.parentSessionId,
        name: context.agent.name
      };
    }
  }

  private resolveSessionProvider(
    session: Session<SessionState>,
    context: MessageContext
  ): string | undefined {
    const providers = listActiveInferenceProviders(this.settings);
    const activeIds = new Set(providers.map((provider) => provider.id));

    let providerId = session.context.state.providerId ?? context.providerId;
    if (!providerId || !activeIds.has(providerId)) {
      const fallback =
        context.providerId && activeIds.has(context.providerId)
          ? context.providerId
          : providers[0]?.id;
      providerId = fallback;
    }

    if (providerId && session.context.state.providerId !== providerId) {
      session.context.state.providerId = providerId;
    }

    return providerId;
  }

  private async handlePermissionDecision(
    source: string,
    decision: PermissionDecision,
    context: MessageContext
  ): Promise<void> {
    if (!context.channelId || !context.userId) {
      logger.error(
        { source, channelId: context.channelId, userId: context.userId },
        "Permission decision missing channelId or userId"
      );
      return;
    }
    const connector = this.connectorRegistry.get(source);
    const permissionTag = formatPermissionTag(decision.access);
    const permissionLabel = describePermissionDecision(decision.access);
    if (!decision.approved) {
      logger.info(
        { source, permission: permissionTag, sessionId: context.sessionId },
        "Permission denied"
      );
    }

    if (!context.sessionId) {
      logger.warn({ source, permission: permissionTag }, "Permission decision without session id");
      if (connector) {
        await connector.sendMessage(context.channelId, {
          text: `Permission ${decision.approved ? "granted" : "denied"} for ${permissionLabel}.`,
          replyToMessageId: context.messageId
        });
      }
      return;
    }

    const session = this.sessionManager.getById(context.sessionId);
    if (!session) {
      logger.warn(
        { source, sessionId: context.sessionId },
        "Session not found for permission decision"
      );
      if (connector) {
        await connector.sendMessage(context.channelId, {
          text: `Permission ${decision.approved ? "granted" : "denied"} for ${permissionLabel}.`,
          replyToMessageId: context.messageId
        });
      }
      return;
    }

    if (decision.approved && (decision.access.kind === "read" || decision.access.kind === "write")) {
      if (!path.isAbsolute(decision.access.path)) {
        logger.warn({ sessionId: session.id, permission: permissionTag }, "Permission path not absolute");
        if (connector) {
          await connector.sendMessage(context.channelId, {
            text: `Permission ignored (path must be absolute): ${permissionLabel}.`,
            replyToMessageId: context.messageId
          });
        }
        return;
      }
    }

    if (decision.approved) {
      applyPermission(session.context.state.permissions, decision);
      try {
        await this.sessionStore.recordState(session);
      } catch (error) {
        logger.warn({ sessionId: session.id, error }, "Permission persistence failed");
      }

      this.eventBus.emit("permission.granted", {
        sessionId: session.id,
        source,
        decision
      });
    }

    const resumeText = decision.approved
      ? `Permission granted for ${permissionLabel}. Please continue with the previous request.`
      : `Permission denied for ${permissionLabel}. Please continue without that permission.`;
    await this.sessionManager.handleMessage(
      source,
      { text: resumeText },
      { ...context, sessionId: session.id },
      (sessionToHandle, entry) => this.handleSessionMessage(entry, sessionToHandle, source)
    );
  }

  private async restoreSessions(): Promise<void> {
    const restoredSessions = await this.sessionStore.loadSessions();
    const pendingInternalErrors: Array<{
      sessionId: string;
      source: string;
      context: MessageContext;
    }> = [];

    for (const restored of restoredSessions) {
      const session = this.sessionManager.restoreSession(
        restored.sessionId,
        restored.storageId,
        normalizeSessionState(restored.state, this.defaultPermissions),
        restored.createdAt,
        restored.updatedAt
      );
      if (!session.context.state.providerId) {
        const providerId = this.resolveProviderId(restored.context);
        if (providerId) {
          session.context.state.providerId = providerId;
        }
      }
      logger.info(
        { sessionId: session.id, source: restored.source },
        "Session restored"
      );
      const sessionKey = this.buildSessionKey(restored.source, restored.context);
      if (sessionKey) {
        this.sessionKeyMap.set(sessionKey, restored.sessionId);
      }
      if (restored.lastEntryType === "incoming") {
        pendingInternalErrors.push({
          sessionId: session.id,
          source: restored.source,
          context: restored.context
        });
      }
    }

    if (pendingInternalErrors.length > 0) {
      await this.sendPendingInternalErrors(pendingInternalErrors);
    }
  }

  private async sendPendingInternalErrors(
    pending: Array<{
      sessionId: string;
      source: string;
      context: MessageContext;
    }>
  ): Promise<void> {
    const message = "Internal error.";
    for (const entry of pending) {
      const connector = this.connectorRegistry.get(entry.source);
      if (!connector) {
        continue;
      }
      try {
        await connector.sendMessage(entry.context.channelId, {
          text: message,
          replyToMessageId: entry.context.messageId
        });
      } catch (error) {
        logger.warn({ sessionId: entry.sessionId, source: entry.source, error }, "Pending reply failed");
      }
    }
  }

  private async handleSessionMessage(
    entry: SessionMessage,
    session: import("./sessions/session.js").Session<SessionState>,
    source: string
  ): Promise<void> {
    const textLen = entry.message.text?.length ?? 0;
    const fileCount = entry.message.files?.length ?? 0;
    logger.debug(`handleSessionMessage started sessionId=${session.id} messageId=${entry.id} source=${source} hasText=${!!entry.message.text} textLength=${textLen} fileCount=${fileCount}`);

    if (!entry.message.text && (!entry.message.files || entry.message.files.length === 0)) {
      logger.debug(`handleSessionMessage skipping - no text or files sessionId=${session.id} messageId=${entry.id}`);
      return;
    }

    const connector = this.connectorRegistry.get(source);
    const isInternal =
      !connector &&
      (source === "system" || entry.context.agent?.kind === "background" || !!entry.context.cron);
    if (!connector && !isInternal) {
      logger.debug(`handleSessionMessage skipping - connector not found sessionId=${session.id} source=${source}`);
      return;
    }
    logger.debug(
      `Connector ${connector ? "found" : "not required"} source=${source} internal=${isInternal}`
    );

    if (entry.context.cron?.filesPath) {
      session.context.state.permissions = normalizePermissions(
        { workingDir: entry.context.cron.filesPath },
        this.defaultPermissions.workingDir
      );
      ensureDefaultFilePermissions(session.context.state.permissions);
    }

    const command = resolveIncomingCommand(entry);
    if (command && connector) {
      const handled = await this.handleSlashCommand(command, entry, session, source, connector);
      if (handled) {
        return;
      }
    }

    await assumeWorkspace();

    const sessionContext = session.context.state.context;
    const providerId = this.resolveSessionProvider(session, entry.context);
    logger.debug(`Building context sessionId=${session.id} existingMessageCount=${sessionContext.messages.length}`);

    const providerSettings = providerId
      ? listActiveInferenceProviders(this.settings).find((p) => p.id === providerId)
      : listActiveInferenceProviders(this.settings)[0];
    const connectorCapabilities = connector?.capabilities ?? null;
    const fileSendModes = connectorCapabilities?.sendFiles?.modes ?? [];
    const channelType = entry.context.channelType;
    const channelIsPrivate = channelType ? channelType === "private" : null;
    const cronContext = entry.context.cron;
    const cronTaskIds = this.cronStore
      ? (await this.cronStore.listTasks()).map((task) => task.id)
      : this.cron?.listTasks().map((task) => task.id) ?? [];
    const pluginPrompts = await this.pluginManager.getSystemPrompts();
    const pluginPrompt = pluginPrompts.length > 0 ? pluginPrompts.join("\n\n") : "";
    const agentKind = session.context.state.agent?.kind ?? entry.context.agent?.kind;
    const systemPrompt = await createSystemPrompt({
      provider: providerSettings?.id,
      model: providerSettings?.model,
      workspace: session.context.state.permissions.workingDir,
      connector: source,
      canSendFiles: fileSendModes.length > 0,
      fileSendModes: fileSendModes.length > 0 ? fileSendModes.join(", ") : "",
      messageFormatPrompt: connectorCapabilities?.messageFormatPrompt ?? "",
      channelId: entry.context.channelId,
      channelType,
      channelIsPrivate,
      userId: entry.context.userId,
      userFirstName: entry.context.userFirstName,
      userLastName: entry.context.userLastName,
      username: entry.context.username,
      cronTaskId: cronContext?.taskId,
      cronTaskName: cronContext?.taskName,
      cronMemoryPath: cronContext?.memoryPath,
      cronFilesPath: cronContext?.filesPath,
      cronTaskIds: cronTaskIds.length > 0 ? cronTaskIds.join(", ") : "",
      soulPath: DEFAULT_SOUL_PATH,
      userPath: DEFAULT_USER_PATH,
      pluginPrompt,
      agentKind,
      parentSessionId: session.context.state.agent?.parentSessionId ?? entry.context.agent?.parentSessionId,
      configDir: this.configDir
    });
    const context: Context = {
      ...sessionContext,
      tools: this.listContextTools(source, {
        agentKind,
        allowCronTools: !!entry.context.cron
      }),
      systemPrompt
    };
    logger.debug(
      `Context built toolCount=${context.tools?.length ?? 0} systemPrompt=${context.systemPrompt ? "set" : "none"}`
    );

    logger.debug("Building user message from entry");
    const userMessage = await buildUserMessage(entry);
    context.messages.push(userMessage);
    logger.debug(`User message added to context totalMessages=${context.messages.length}`);

    const providersForSession = providerId
      ? listActiveInferenceProviders(this.settings).filter((provider) => provider.id === providerId)
      : [];
    logger.debug(`Session provider resolved sessionId=${session.id} providerId=${providerId ?? "none"} providerCount=${providersForSession.length}`);

    let response: Awaited<ReturnType<InferenceRouter["complete"]>> | null = null;
    let toolLoopExceeded = false;
    const generatedFiles: FileReference[] = [];
    logger.debug(`Starting typing indicator channelId=${entry.context.channelId}`);
    const stopTyping = connector?.startTyping?.(entry.context.channelId);

    try {
      logger.debug(`Starting inference loop maxIterations=${MAX_TOOL_ITERATIONS}`);
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
        logger.debug(`Inference loop iteration=${iteration} sessionId=${session.id} messageCount=${context.messages.length}`);
        response = await this.inferenceRouter.complete(context, session.id, {
          providersOverride: providersForSession,
          onAttempt: (providerId, modelId) => {
            logger.debug(`Inference attempt starting providerId=${providerId} modelId=${modelId} sessionId=${session.id}`);
            logger.info(
              { sessionId: session.id, messageId: entry.id, provider: providerId, model: modelId },
              "Inference started"
            );
          },
          onFallback: (providerId, error) => {
            logger.debug(`Inference falling back to next provider providerId=${providerId} error=${String(error)}`);
            logger.warn(
              { sessionId: session.id, messageId: entry.id, provider: providerId, error },
              "Inference fallback"
            );
          },
          onSuccess: (providerId, modelId, message) => {
            logger.debug(`Inference succeeded providerId=${providerId} modelId=${modelId} stopReason=${message.stopReason} inputTokens=${message.usage?.input} outputTokens=${message.usage?.output}`);
            logger.info(
              { sessionId: session.id, messageId: entry.id, provider: providerId, model: modelId, stopReason: message.stopReason, usage: message.usage },
              "Inference completed"
            );
          },
          onFailure: (providerId, error) => {
            logger.debug(`Inference failed completely providerId=${providerId} error=${String(error)}`);
            logger.warn(
              { sessionId: session.id, messageId: entry.id, provider: providerId, error },
              "Inference failed"
            );
          }
        });

        logger.debug(`Inference response received providerId=${response.providerId} modelId=${response.modelId} stopReason=${response.message.stopReason}`);
        context.messages.push(response.message);

        const toolCalls = extractToolCalls(response.message);
        logger.debug(`Extracted tool calls from response toolCallCount=${toolCalls.length}`);
        if (toolCalls.length === 0) {
          logger.debug(`No tool calls, breaking inference loop iteration=${iteration}`);
          break;
        }

        for (const toolCall of toolCalls) {
          const argsPreview = JSON.stringify(toolCall.arguments).slice(0, 200);
          logger.debug(`Executing tool call toolName=${toolCall.name} toolCallId=${toolCall.id} args=${argsPreview}`);
          const toolResult = await this.toolResolver.execute(toolCall, {
            connectorRegistry: this.connectorRegistry,
            fileStore: this.fileStore,
            auth: this.authStore,
            logger,
            assistant: this.settings.assistant ?? null,
            permissions: session.context.state.permissions,
            session,
            source,
            messageContext: entry.context,
            agentRuntime: this.buildAgentRuntime()
          });
          logger.debug(`Tool execution completed toolName=${toolCall.name} isError=${toolResult.toolMessage.isError} fileCount=${toolResult.files?.length ?? 0}`);
          context.messages.push(toolResult.toolMessage);
          if (toolResult.files?.length) {
            generatedFiles.push(...toolResult.files);
            logger.debug(`Tool generated files count=${toolResult.files.length}`);
          }
        }

        if (iteration === MAX_TOOL_ITERATIONS - 1) {
          logger.debug(`Tool loop limit reached iteration=${iteration}`);
          toolLoopExceeded = true;
        }
      }
      logger.debug("Inference loop completed");
    } catch (error) {
      logger.debug(`Inference loop caught error error=${String(error)}`);
      logger.warn({ connector: source, error }, "Inference failed");
      const message =
        error instanceof Error && error.message === "No inference provider available"
          ? "No inference provider available."
          : "Inference failed.";
      logger.debug(`Sending error message to user message=${message}`);
      if (connector) {
        await connector.sendMessage(entry.context.channelId, {
          text: message,
          replyToMessageId: entry.context.messageId
        });
        await recordOutgoingEntry(this.sessionStore, session, source, entry.context, message);
      }
      await recordSessionState(this.sessionStore, session, source);
      logger.debug("handleSessionMessage completed with error");
      return;
    } finally {
      logger.debug("Stopping typing indicator");
      stopTyping?.();
    }

    if (!response) {
      logger.debug("No response received, recording session state only");
      await recordSessionState(this.sessionStore, session, source);
      return;
    }

    if (response.message.stopReason === "error" || response.message.stopReason === "aborted") {
      const message = "Inference failed.";
      const errorDetail =
        response.message.errorMessage && response.message.errorMessage.length > 0
          ? response.message.errorMessage
          : "unknown";
      logger.warn(
        `Inference returned error response provider=${response.providerId} model=${response.modelId} stopReason=${response.message.stopReason} error=${errorDetail}`
      );
      try {
        if (connector) {
          await connector.sendMessage(entry.context.channelId, {
            text: message,
            replyToMessageId: entry.context.messageId
          });
          await recordOutgoingEntry(this.sessionStore, session, source, entry.context, message);
          this.eventBus.emit("session.outgoing", {
            sessionId: session.id,
            source,
            message: { text: message },
            context: entry.context
          });
        }
      } catch (error) {
        logger.warn({ connector: source, error }, "Failed to send error response");
      } finally {
        await recordSessionState(this.sessionStore, session, source);
        logger.debug("handleSessionMessage completed with error stop reason");
      }
      return;
    }

    const responseText = extractAssistantText(response.message);
    logger.debug(`Extracted assistant text hasText=${!!responseText} textLength=${responseText?.length ?? 0} generatedFileCount=${generatedFiles.length}`);

    if (!responseText && generatedFiles.length === 0) {
      if (toolLoopExceeded) {
        const message = "Tool execution limit reached.";
        logger.debug("Tool loop exceeded, sending error message");
        try {
          if (connector) {
            await connector.sendMessage(entry.context.channelId, {
              text: message,
              replyToMessageId: entry.context.messageId
            });
            await recordOutgoingEntry(this.sessionStore, session, source, entry.context, message);
          }
        } catch (error) {
          logger.warn({ connector: source, error }, "Failed to send tool error");
        }
      }
      await recordSessionState(this.sessionStore, session, source);
      logger.debug("handleSessionMessage completed with no response text");
      return;
    }

    const outgoingText = responseText ?? (generatedFiles.length > 0 ? "Generated files." : null);
    logger.debug(`Sending response to user textLength=${outgoingText?.length ?? 0} fileCount=${generatedFiles.length} channelId=${entry.context.channelId}`);
    try {
      if (connector) {
        await connector.sendMessage(entry.context.channelId, {
          text: outgoingText,
          files: generatedFiles.length > 0 ? generatedFiles : undefined,
          replyToMessageId: entry.context.messageId
        });
        logger.debug("Response sent successfully");
        await recordOutgoingEntry(this.sessionStore, session, source, entry.context, outgoingText, generatedFiles);
        this.eventBus.emit("session.outgoing", {
          sessionId: session.id,
          source,
          message: {
            text: outgoingText,
            files: generatedFiles.length > 0 ? generatedFiles : undefined
          },
          context: entry.context
        });
        logger.debug("Session outgoing event emitted");
      }
    } catch (error) {
      logger.debug(`Failed to send response error=${String(error)}`);
      logger.warn({ connector: source, error }, "Failed to send response");
    } finally {
      await recordSessionState(this.sessionStore, session, source);
      logger.debug("handleSessionMessage completed successfully");
    }
  }

  private getOrCreateSessionId(key: string): string {
    const existing = this.sessionKeyMap.get(key);
    if (existing) {
      return existing;
    }
    const id = createId();
    this.sessionKeyMap.set(key, id);
    return id;
  }

  private buildSessionKey(source: string, context: MessageContext): string | null {
    if (!context.userId) {
      logger.warn(
        { source, channelId: context.channelId },
        "Missing userId for session mapping"
      );
      return null;
    }
    return `${source}:${context.channelId}:${context.userId}`;
  }
}

async function buildUserMessage(
  entry: SessionMessage
): Promise<Context["messages"][number]> {
  const text = entry.message.text ?? "";
  const files = entry.message.files ?? [];
  if (files.length === 0) {
    return {
      role: "user",
      content: text,
      timestamp: Date.now()
    };
  }

  const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
  if (text) {
    content.push({ type: "text", text });
  }

  for (const file of files) {
    if (file.mimeType.startsWith("image/")) {
      const data = await fs.readFile(file.path);
      content.push({
        type: "image",
        data: data.toString("base64"),
        mimeType: file.mimeType
      });
    } else {
      content.push({
        type: "text",
        text: `File received: ${file.name} (${file.mimeType}, ${file.size} bytes)`
      });
    }
  }

  return {
    role: "user",
    content,
    timestamp: Date.now()
  };
}

async function recordOutgoingEntry(
  sessionStore: SessionStore<SessionState>,
  session: import("./sessions/session.js").Session<SessionState>,
  source: string,
  context: MessageContext,
  text: string | null,
  files?: FileReference[]
): Promise<void> {
  const messageId = createId();
  try {
    await sessionStore.recordOutgoing(session, messageId, source, context, text, files);
  } catch (error) {
    logger.warn({ sessionId: session.id, source, messageId, error }, "Session persistence failed");
  }
}

async function recordSessionState(
  sessionStore: SessionStore<SessionState>,
  session: import("./sessions/session.js").Session<SessionState>,
  source: string
): Promise<void> {
  try {
    await sessionStore.recordState(session);
  } catch (error) {
    logger.warn({ sessionId: session.id, source, error }, "Session persistence failed");
  }
}

function extractAssistantText(message: Context["messages"][number]): string | null {
  if (message.role !== "assistant") {
    return null;
  }
  const parts = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .filter((text): text is string => typeof text === "string" && text.length > 0);
  return parts.join("\n");
}

function extractToolCalls(message: Context["messages"][number]): ToolCall[] {
  if (message.role !== "assistant") {
    return [];
  }
  return message.content.filter(
    (block): block is ToolCall => block.type === "toolCall"
  );
}

function filterConnectorTools<T extends { name: string }>(
  tools: T[],
  supportsFiles: boolean,
  supportsReactions: boolean
): T[] {
  let filtered: T[] = tools;
  if (!supportsFiles) {
    filtered = filtered.filter((tool) => tool.name !== "send_file");
  }
  if (!supportsReactions) {
    filtered = filtered.filter((tool) => tool.name !== "set_reaction");
  }
  return filtered;
}

function formatIncomingMessage(
  message: ConnectorMessage,
  context: MessageContext,
  receivedAt: Date
): ConnectorMessage {
  if (!message.text && (!message.files || message.files.length === 0)) {
    return message;
  }
  const time = formatTimeAI(receivedAt);
  const text = message.text ?? "";
  const messageIdTag = context.messageId
    ? `<message_id>${context.messageId}</message_id>`
    : "";
  return {
    ...message,
    rawText: message.rawText ?? message.text,
    text: `<time>${time}</time>${messageIdTag}<message>${text}</message>`
  };
}

function sanitizeRoutingContext(context: MessageContext): MessageContext {
  const { messageId, commands, ...rest } = context;
  return { ...rest };
}

function buildSystemMessageText(text: string, origin?: "background" | "system"): string {
  const trimmed = text.trim();
  const originTag = origin ? ` origin=\"${origin}\"` : "";
  return `<system_message${originTag}>${trimmed}</system_message>`;
}

function isHumanDmSession(source: string, context: MessageContext): boolean {
  const blockedSources = new Set(["system", "cron", "background"]);
  if (blockedSources.has(source)) {
    return false;
  }
  const userId = context.userId?.toLowerCase();
  if (!userId || ["system", "cron", "background"].includes(userId)) {
    return false;
  }
  const channelType = context.channelType;
  if (!channelType) {
    return true;
  }
  return channelType === "private" || channelType === "unknown";
}

function getSessionTimestamp(value?: Date | string): number {
  if (!value) {
    return 0;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : 0;
}

type ResolvedCommand = {
  name: string;
  raw: string;
  args?: string;
};

function resolveIncomingCommand(entry: SessionMessage): ResolvedCommand | null {
  const contextCommands = entry.context.commands ?? [];
  if (contextCommands.length > 0) {
    const first = contextCommands[0]!;
    return {
      name: first.name,
      raw: first.raw,
      args: first.args
    };
  }

  const rawText = entry.message.rawText ?? entry.message.text ?? "";
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const [head, ...rest] = trimmed.split(/\s+/);
  if (!head) {
    return null;
  }
  const name = head.slice(1).split("@")[0] ?? "";
  if (!name) {
    return null;
  }
  const args = rest.join(" ").trim();
  return {
    name,
    raw: head,
    args: args.length > 0 ? args : undefined
  };
}

function normalizeSessionState(
  state: unknown,
  defaultPermissions: SessionPermissions
): SessionState {
  const fallback: SessionState = {
    context: { messages: [] },
    providerId: undefined,
    permissions: { ...defaultPermissions }
  };
  if (state && typeof state === "object") {
    const candidate = state as {
      context?: Context;
      providerId?: string;
      permissions?: unknown;
      routing?: unknown;
      agent?: unknown;
    };
    const permissions = normalizePermissions(
      candidate.permissions,
      defaultPermissions.workingDir
    );
    ensureDefaultFilePermissions(permissions);
    const routing = normalizeRouting(candidate.routing);
    const agent = normalizeAgent(candidate.agent);
    if (candidate.context && Array.isArray(candidate.context.messages)) {
      return {
        context: candidate.context,
        providerId: typeof candidate.providerId === "string" ? candidate.providerId : undefined,
        permissions,
        routing,
        agent
      };
    }
    return { ...fallback, permissions, routing, agent };
  }
  return fallback;
}

function normalizeRouting(value: unknown): SessionState["routing"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as { source?: unknown; context?: unknown };
  if (typeof candidate.source !== "string") {
    return undefined;
  }
  if (!candidate.context || typeof candidate.context !== "object") {
    return undefined;
  }
  const context = candidate.context as MessageContext;
  if (!context.channelId || !context.userId) {
    return undefined;
  }
  return { source: candidate.source, context };
}

function normalizeAgent(value: unknown): SessionState["agent"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as { kind?: unknown; parentSessionId?: unknown; name?: unknown };
  if (candidate.kind !== "background") {
    return undefined;
  }
  return {
    kind: "background",
    parentSessionId:
      typeof candidate.parentSessionId === "string" ? candidate.parentSessionId : undefined,
    name: typeof candidate.name === "string" ? candidate.name : undefined
  };
}

function buildDefaultPermissions(workingDir: string): SessionPermissions {
  const writeDirs = [DEFAULT_SOUL_PATH, DEFAULT_USER_PATH].map((entry) =>
    path.resolve(entry)
  );
  const readDirs = [...writeDirs];
  return {
    workingDir: path.resolve(workingDir),
    writeDirs: Array.from(new Set(writeDirs)),
    readDirs: Array.from(new Set(readDirs)),
    web: false
  };
}

function ensureDefaultFilePermissions(permissions: SessionPermissions): void {
  const defaults = [DEFAULT_SOUL_PATH, DEFAULT_USER_PATH].map((entry) =>
    path.resolve(entry)
  );
  const nextWrite = new Set([...permissions.writeDirs, ...defaults]);
  const nextRead = new Set([...permissions.readDirs, ...defaults]);
  permissions.writeDirs = Array.from(nextWrite.values());
  permissions.readDirs = Array.from(nextRead.values());
}

function applyPermission(
  permissions: SessionPermissions,
  decision: PermissionDecision
): void {
  if (!decision.approved) {
    return;
  }
  if (decision.access.kind === "web") {
    permissions.web = true;
    return;
  }
  if (!path.isAbsolute(decision.access.path)) {
    return;
  }
  const resolved = path.resolve(decision.access.path);
  if (decision.access.kind === "write") {
    const next = new Set(permissions.writeDirs);
    next.add(resolved);
    permissions.writeDirs = Array.from(next.values());
    return;
  }
  if (decision.access.kind === "read") {
    const next = new Set(permissions.readDirs);
    next.add(resolved);
    permissions.readDirs = Array.from(next.values());
  }
}

function formatPermissionTag(access: PermissionAccess): string {
  if (access.kind === "web") {
    return "@web";
  }
  return `@${access.kind}:${access.path}`;
}

function describePermissionDecision(access: PermissionAccess): string {
  if (access.kind === "web") {
    return "web access";
  }
  if (access.kind === "read") {
    return `read access to ${access.path}`;
  }
  return `write access to ${access.path}`;
}
