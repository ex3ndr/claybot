import { createId } from "@paralleldrive/cuid2";
import type { Context, ToolCall } from "@mariozechner/pi-ai";
import path from "node:path";

import { getLogger } from "../log.js";
import {
  ConnectorRegistry,
  ImageGenerationRegistry,
  InferenceRegistry,
  ToolResolver
} from "./modules.js";
import type {
  ConnectorMessage,
  MessageContext,
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
  resolveWorkspaceDir,
  type SessionPermissions
} from "./permissions.js";
import { permissionApply } from "./permissions/permissionApply.js";
import { permissionBuildCron } from "./permissions/permissionBuildCron.js";
import { permissionBuildDefault } from "./permissions/permissionBuildDefault.js";
import { permissionDescribeDecision } from "./permissions/permissionDescribeDecision.js";
import { permissionEnsureDefaultFile } from "./permissions/permissionEnsureDefaultFile.js";
import { permissionFormatTag } from "./permissions/permissionFormatTag.js";
import { permissionMergeDefault } from "./permissions/permissionMergeDefault.js";
import { assumeWorkspace, createSystemPrompt } from "./createSystemPrompt.js";
import { getProviderDefinition, listActiveInferenceProviders } from "../providers/catalog.js";
import { SessionManager } from "./sessions/manager.js";
import { SessionStore } from "./sessions/store.js";
import {
  normalizeSessionDescriptor,
  sessionDescriptorMatchesStrategy,
  type SessionDescriptor,
  type SessionFetchStrategy
} from "./sessions/descriptor.js";
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
import {
  buildHeartbeatAddTool,
  buildHeartbeatListTool,
  buildHeartbeatRemoveTool,
  buildHeartbeatRunTool
} from "./tools/heartbeat.js";
import { buildSendSessionMessageTool, buildStartBackgroundAgentTool } from "./tools/background.js";
import { cuid2Is } from "../utils/cuid2Is.js";
import type {
  AgentRuntime,
  HeartbeatAddArgs,
  HeartbeatRemoveArgs,
  ToolExecutionResult
} from "./tools/types.js";
import { CronScheduler } from "./cron/cronScheduler.js";
import { CronStore } from "./cron/cronStore.js";
import { HeartbeatScheduler } from "./heartbeat.js";
import { heartbeatPromptBuildBatch } from "./heartbeatPromptBuildBatch.js";
import { toolArgsFormatVerbose } from "./tools/toolArgsFormatVerbose.js";
import { toolListContextBuild } from "./tools/toolListContextBuild.js";
import { toolResultFormatVerbose } from "./tools/toolResultFormatVerbose.js";
import { messageBuildSystemText } from "./messages/messageBuildSystemText.js";
import { messageBuildUser } from "./messages/messageBuildUser.js";
import { messageExtractText } from "./messages/messageExtractText.js";
import { messageExtractToolCalls } from "./messages/messageExtractToolCalls.js";
import { messageFormatIncoming } from "./messages/messageFormatIncoming.js";
import { messageIsSystemText } from "./messages/messageIsSystemText.js";
import { sessionContextIsCron } from "./sessions/sessionContextIsCron.js";
import { sessionContextIsHeartbeat } from "./sessions/sessionContextIsHeartbeat.js";
import { sessionDescriptorBuild } from "./sessions/sessionDescriptorBuild.js";
import { sessionKeyBuild } from "./sessions/sessionKeyBuild.js";
import { sessionKeyResolve } from "./sessions/sessionKeyResolve.js";
import { sessionRecordOutgoing } from "./sessions/sessionRecordOutgoing.js";
import { sessionRecordState } from "./sessions/sessionRecordState.js";
import { sessionRoutingSanitize } from "./sessions/sessionRoutingSanitize.js";
import { sessionStateNormalize } from "./sessions/sessionStateNormalize.js";
import { sessionTimestampGet } from "./sessions/sessionTimestampGet.js";
import type { SessionState } from "./sessions/sessionStateTypes.js";
import { HeartbeatStore, type HeartbeatDefinition } from "./heartbeat-store.js";
import { EngineEventBus } from "./ipc/events.js";
import { ProviderManager } from "../providers/manager.js";
import { DEFAULT_SOUL_PATH, DEFAULT_USER_PATH } from "../paths.js";
import { formatSkillsPrompt, listCoreSkills, listRegisteredSkills } from "./skills/catalog.js";

const logger = getLogger("engine.runtime");
const MAX_TOOL_ITERATIONS = 5;

type BackgroundAgentState = {
  sessionId: string;
  storageId: string;
  name?: string;
  parentSessionId?: string;
  status: "running" | "queued" | "idle";
  pending: number;
  updatedAt?: string;
};

export type EngineOptions = {
  settings: SettingsConfig;
  dataDir: string;
  authPath: string;
  eventBus: EngineEventBus;
  configDir: string;
  verbose?: boolean;
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
  private verbose: boolean;

  constructor(options: EngineOptions) {
    logger.debug(`Engine constructor starting, dataDir=${options.dataDir}`);
    this.settings = options.settings;
    this.dataDir = options.dataDir;
    this.configDir = options.configDir;
    this.verbose = options.verbose ?? false;
    this.workspaceDir = resolveWorkspaceDir(this.configDir, this.settings.assistant ?? null);
    this.defaultPermissions = permissionBuildDefault(this.workspaceDir, this.configDir);
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
        permissions: { ...this.defaultPermissions },
        session: undefined
      }),
      sessionIdFor: (source, context) => {
        const key = sessionKeyResolve(source, context, logger);
        const cronTaskUid = cuid2Is(context.cron?.taskUid ?? null)
          ? context.cron!.taskUid
          : null;
        // Session ids are always cuid2; ignore non-cuid2 ids from connectors.
        const explicitId = cuid2Is(context.sessionId ?? null)
          ? context.sessionId!
          : cronTaskUid;
        if (explicitId) {
          if (key) {
            this.sessionKeyMap.set(key, explicitId);
          }
          return explicitId;
        }
        if (key) {
          return this.getOrCreateSessionId(key);
        }
        if (source && source !== "system" && source !== "cron" && source !== "background") {
          throw new Error("userId is required to map sessions for connectors.");
        }
        return createId();
      },
      storageIdFactory: () => this.sessionStore.createStorageId(),
      messageTransform: (message, context, receivedAt) => {
        return messageFormatIncoming(message, context, receivedAt);
      },
      onSessionCreated: (session, source, context) => {
        this.captureRouting(session, source, context);
        this.captureAgent(session, context);
        const providerId = this.resolveProviderId(context);
        if (providerId) {
          session.context.state.providerId = providerId;
        }
        session.context.state.session = sessionDescriptorBuild(source, context, session.id);
        if (context.cron?.filesPath) {
          session.context.state.permissions = permissionBuildCron(
            this.defaultPermissions,
            context.cron.filesPath
          );
        } else if (sessionContextIsHeartbeat(context, session.context.state.session)) {
          session.context.state.permissions = permissionMergeDefault(
            session.context.state.permissions,
            this.defaultPermissions
          );
          permissionEnsureDefaultFile(
            session.context.state.permissions,
            this.defaultPermissions
          );
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
          .recordSessionCreated(session, source, context, session.context.state.session)
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
        const rawText = entry.message.rawText ?? entry.message.text ?? "";
        if (!messageIsSystemText(rawText)) {
          void this.sessionStore.recordIncoming(session, entry, source).catch((error) => {
            logger.warn(
              { sessionId: session.id, source, messageId: entry.id, error },
              "Session persistence failed"
            );
          });
        }
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
            taskUid: task.taskUid,
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
      },
      onTaskComplete: (task, runAt) => {
        this.eventBus.emit("cron.task.ran", { taskId: task.id, runAt: runAt.toISOString() });
      }
    });

    const heartbeatPath = path.join(this.configDir, "heartbeat");
    logger.debug(`Initializing HeartbeatScheduler heartbeatPath=${heartbeatPath}`);
    this.heartbeatStore = new HeartbeatStore(heartbeatPath);
    await this.heartbeatStore.ensureDir();
    this.heartbeat = new HeartbeatScheduler({
      store: this.heartbeatStore,
      intervalMs: 30 * 60 * 1000,
      onRun: async (tasks) => {
        const heartbeatKey = sessionKeyBuild({ type: "heartbeat" });
        const resolved = this.resolveSessionId("heartbeat");
        const sessionId = resolved ?? (heartbeatKey ? this.getOrCreateSessionId(heartbeatKey) : createId());
        const batch = heartbeatPromptBuildBatch(tasks);
        await this.startBackgroundAgent({
          prompt: batch.prompt,
          sessionId,
          context: {
            userId: "heartbeat",
            heartbeat: {}
          }
        });
      },
      onError: (error, taskIds) => {
        logger.warn({ taskIds, error }, "Heartbeat task failed");
      },
      onTaskComplete: (task, runAt) => {
        this.eventBus.emit("heartbeat.task.ran", { taskId: task.id, runAt: runAt.toISOString() });
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
    this.toolResolver.register("core", buildHeartbeatRunTool());
    this.toolResolver.register("core", buildHeartbeatAddTool());
    this.toolResolver.register("core", buildHeartbeatListTool());
    this.toolResolver.register("core", buildHeartbeatRemoveTool());
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
      const heartbeatTasks = await this.heartbeat.listTasks();
      this.eventBus.emit("heartbeat.started", { tasks: heartbeatTasks });
      if (heartbeatTasks.length === 0) {
        logger.info("No heartbeat tasks found on boot.");
      } else {
        const withLastRun = heartbeatTasks.filter((task) => !!task.lastRunAt);
        const missingLastRun = heartbeatTasks.filter((task) => !task.lastRunAt);
        if (withLastRun.length > 0) {
          const mostRecent = withLastRun
            .map((task) => task.lastRunAt as string)
            .sort()
            .at(-1);
          logger.info(
            {
              taskCount: heartbeatTasks.length,
              mostRecentRunAt: mostRecent
            },
            "Heartbeat last run loaded on boot"
          );
        }
        if (missingLastRun.length > 0) {
          logger.info(
            {
              taskCount: missingLastRun.length,
              taskIds: missingLastRun.map((task) => task.id)
            },
            "Heartbeat missing last run info; running now"
          );
          await this.heartbeat.runNow(missingLastRun.map((task) => task.id));
        }
        const nextRunAt =
          this.heartbeat.getNextRunAt() ??
          new Date(Date.now() + this.heartbeat.getIntervalMs());
        logger.info(
          {
            nextRunAt: nextRunAt.toISOString()
          },
          "Next heartbeat run scheduled"
        );
      }
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

  async getHeartbeatTasks(): Promise<HeartbeatDefinition[]> {
    if (this.heartbeat) {
      return this.heartbeat.listTasks();
    }
    if (this.heartbeatStore) {
      return this.heartbeatStore.listTasks();
    }
    return [];
  }

  getBackgroundAgents(): BackgroundAgentState[] {
    return this.sessionManager
      .listSessions()
      .filter((session) => session.context.state.agent?.kind === "background")
      .map((session) => {
        const pending = session.size;
        const processing = session.isProcessing();
        const status = processing ? "running" : pending > 0 ? "queued" : "idle";
        return {
          sessionId: session.id,
          storageId: session.storageId,
          name: session.context.state.agent?.name,
          parentSessionId: session.context.state.agent?.parentSessionId,
          status,
          pending,
          updatedAt: session.context.updatedAt?.toISOString()
        };
      });
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

  /**
   * Returns a cloned default permissions object for new sessions.
   * Expects: callers treat the return value as mutable session-scoped state.
   */
  getDefaultPermissions(): SessionPermissions {
    return {
      ...this.defaultPermissions,
      writeDirs: [...this.defaultPermissions.writeDirs],
      readDirs: [...this.defaultPermissions.readDirs]
    };
  }

  private listContextTools(
    source?: string,
    options?: { agentKind?: "background" | "foreground"; allowCronTools?: boolean }
  ) {
    return toolListContextBuild({
      tools: this.toolResolver.listTools(),
      source,
      agentKind: options?.agentKind,
      allowCronTools: options?.allowCronTools,
      connectorRegistry: this.connectorRegistry,
      imageRegistry: this.imageRegistry
    });
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
    const sessionId = cuid2Is(messageContext?.sessionId ?? null)
      ? messageContext!.sessionId!
      : createId();
    const session = new Session<SessionState>(
      sessionId,
      {
        id: sessionId,
        createdAt: now,
        updatedAt: now,
        state: {
          context: { messages: [] },
          providerId: undefined,
          permissions: { ...this.defaultPermissions },
          session: undefined
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
    session.context.state.session = sessionDescriptorBuild("system", context, sessionId);

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
      runHeartbeatNow: (args) => this.runHeartbeatNow(args),
      addHeartbeatTask: (args) => this.addHeartbeatTask(args),
      listHeartbeatTasks: () => this.listHeartbeatTasks(),
      removeHeartbeatTask: (args) => this.removeHeartbeatTask(args)
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
    const sessionId = cuid2Is(args.sessionId ?? null) ? args.sessionId! : createId();
    const isSubagent = !args.context?.cron && !args.context?.heartbeat;
    const agentParent = args.parentSessionId ?? args.context?.agent?.parentSessionId;
    const agentName = args.name ?? args.context?.agent?.name ?? (isSubagent ? "subagent" : undefined);
    if (isSubagent && !agentParent) {
      throw new Error("Subagent parent session is required");
    }
    const agentContext = {
      kind: "background" as const,
      parentSessionId: agentParent,
      name: agentName
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
    const startPromise = this.sessionManager.handleMessage(
      "system",
      message,
      messageContext,
      (session, entry) => this.handleSessionMessage(entry, session, "system")
    );
    startPromise.catch((error) => {
      logger.warn({ sessionId, error }, "Background agent start failed");
    });
    return { sessionId };
  }

  private async sendSessionMessage(args: {
    sessionId?: string;
    text: string;
    origin?: "background" | "system";
  }): Promise<void> {
    const targetSessionId = args.sessionId ?? this.resolveSessionId("most-recent-foreground");
    if (!targetSessionId) {
      throw new Error("No recent foreground session found.");
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
      text: messageBuildSystemText(args.text, args.origin)
    };
    await this.sessionManager.handleMessage(
      source,
      message,
      context,
      (sessionToHandle, entry) => this.handleSessionMessage(entry, sessionToHandle, source)
    );
  }

  private async notifySubagentFailure(
    session: Session<SessionState>,
    reason: string,
    error?: unknown
  ): Promise<void> {
    const descriptor = session.context.state.session;
    if (descriptor?.type !== "subagent") {
      return;
    }
    const parentSessionId =
      descriptor.parentSessionId ?? session.context.state.agent?.parentSessionId;
    if (!parentSessionId) {
      logger.warn({ sessionId: session.id }, "Subagent missing parent session");
      return;
    }
    const name = descriptor.name ?? session.context.state.agent?.name ?? "subagent";
    const errorText =
      error instanceof Error ? error.message : error ? String(error) : "";
    const detail = errorText ? `${reason} (${errorText})` : reason;
    try {
      await this.sendSessionMessage({
        sessionId: parentSessionId,
        text: `Subagent ${name} (${session.id}) failed: ${detail}.`,
        origin: "background"
      });
    } catch (sendError) {
      logger.warn(
        { sessionId: session.id, parentSessionId, error: sendError },
        "Subagent failure notification failed"
      );
    }
  }

  private resolveSessionId(strategy: SessionFetchStrategy): string | null {
    const sessions = this.sessionManager.listSessions();
    const candidates = sessions.filter((session) => {
      const sessionDescriptor = session.context.state.session;
      if (!sessionDescriptor) {
        return false;
      }
      return sessionDescriptorMatchesStrategy(sessionDescriptor, strategy);
    });
    if (candidates.length === 0) {
      return null;
    }
    candidates.sort((a, b) => {
      const aTime = sessionTimestampGet(a.context.updatedAt ?? a.context.createdAt);
      const bTime = sessionTimestampGet(b.context.updatedAt ?? b.context.createdAt);
      return bTime - aTime;
    });
    return candidates[0]?.id ?? null;
  }

  private async runHeartbeatNow(args?: { ids?: string[] }): Promise<{ ran: number; taskIds: string[] }> {
    if (!this.heartbeat) {
      throw new Error("Heartbeat scheduler unavailable");
    }
    return this.heartbeat.runNow(args?.ids);
  }

  private async addHeartbeatTask(args: HeartbeatAddArgs): Promise<HeartbeatDefinition> {
    if (!this.heartbeatStore) {
      throw new Error("Heartbeat store unavailable");
    }
    return this.heartbeatStore.createTask({
      id: args.id,
      title: args.title,
      prompt: args.prompt,
      overwrite: args.overwrite
    });
  }

  private async listHeartbeatTasks(): Promise<HeartbeatDefinition[]> {
    return this.getHeartbeatTasks();
  }

  private async removeHeartbeatTask(
    args: HeartbeatRemoveArgs
  ): Promise<{ removed: boolean }> {
    if (!this.heartbeatStore) {
      throw new Error("Heartbeat store unavailable");
    }
    const removed = await this.heartbeatStore.deleteTask(args.id);
    return { removed };
  }


  async updateSettings(settings: SettingsConfig): Promise<void> {
    this.settings = settings;
    this.workspaceDir = resolveWorkspaceDir(this.configDir, this.settings.assistant ?? null);
    this.defaultPermissions = permissionBuildDefault(this.workspaceDir, this.configDir);
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
      context: sessionRoutingSanitize(context)
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
    if (!context.channelId) {
      logger.error(
        { source, channelId: context.channelId, userId: context.userId },
        "Permission decision missing channelId"
      );
      return;
    }
    if (!context.userId) {
      logger.warn(
        { source, channelId: context.channelId },
        "Permission decision missing userId"
      );
    }
    const connector = this.connectorRegistry.get(source);
    const permissionTag = permissionFormatTag(decision.access);
    const permissionLabel = permissionDescribeDecision(decision.access);
    let sessionId = cuid2Is(context.sessionId ?? null) ? context.sessionId! : null;
    if (!sessionId) {
      const key = sessionKeyResolve(source, context, logger);
      if (key) {
        sessionId = this.sessionKeyMap.get(key) ?? null;
      }
    }

    if (!decision.approved) {
      logger.info(
        { source, permission: permissionTag, sessionId },
        "Permission denied"
      );
    }

    if (!sessionId) {
      logger.warn({ source, permission: permissionTag }, "Permission decision without session id");
      if (connector) {
        await connector.sendMessage(context.channelId, {
          text: `Permission ${decision.approved ? "granted" : "denied"} for ${permissionLabel}.`,
          replyToMessageId: context.messageId
        });
      }
      return;
    }

    const session = this.sessionManager.getById(sessionId);
    if (!session) {
      logger.warn(
        { source, sessionId },
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
      permissionApply(session.context.state.permissions, decision);
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
    const pendingSubagentFailures: Session<SessionState>[] = [];

    for (const restored of restoredSessions) {
      const restoredSessionId = cuid2Is(restored.sessionId ?? null)
        ? restored.sessionId
        : createId();
      const session = this.sessionManager.restoreSession(
        restoredSessionId,
        restored.storageId,
        sessionStateNormalize(restored.state, this.defaultPermissions),
        restored.createdAt,
        restored.updatedAt
      );
      const restoredDescriptor = restored.descriptor
        ? normalizeSessionDescriptor(restored.descriptor)
        : undefined;
      if (restoredDescriptor) {
        session.context.state.session = restoredDescriptor;
      }
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
      const sessionKey = session.context.state.session
        ? sessionKeyBuild(session.context.state.session)
        : null;
      if (sessionKey) {
        this.sessionKeyMap.set(sessionKey, session.id);
      }
      if (restoredSessionId !== restored.sessionId) {
        void this.sessionStore.recordState(session).catch((error) => {
          logger.warn({ sessionId: session.id, error }, "Session id migration failed");
        });
      }
      if (restored.lastEntryType === "incoming") {
        if (session.context.state.session?.type === "subagent") {
          pendingSubagentFailures.push(session);
        } else {
          pendingInternalErrors.push({
            sessionId: session.id,
            source: restored.source,
            context: restored.context
          });
        }
      }
    }

    if (pendingSubagentFailures.length > 0) {
      await this.notifyPendingSubagentFailures(pendingSubagentFailures);
    }
    if (pendingInternalErrors.length > 0) {
      await this.sendPendingInternalErrors(pendingInternalErrors);
    }
  }

  private async notifyPendingSubagentFailures(
    pending: Session<SessionState>[]
  ): Promise<void> {
    for (const session of pending) {
      await this.notifySubagentFailure(session, "Restored with pending work");
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

    if (!session.context.state.session) {
      session.context.state.session = sessionDescriptorBuild(source, entry.context, session.id);
    }
    if (entry.context.cron?.filesPath) {
      session.context.state.permissions = permissionBuildCron(
        this.defaultPermissions,
        entry.context.cron.filesPath
      );
    } else if (sessionContextIsHeartbeat(entry.context, session.context.state.session)) {
      session.context.state.permissions = permissionMergeDefault(
        session.context.state.permissions,
        this.defaultPermissions
      );
      permissionEnsureDefaultFile(session.context.state.permissions, this.defaultPermissions);
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
    const coreSkills = await listCoreSkills();
    const pluginSkills = await listRegisteredSkills(this.pluginManager.listRegisteredSkills());
    const skills = [...coreSkills, ...pluginSkills];
    const skillsPrompt = formatSkillsPrompt(skills);
    const agentKind = session.context.state.agent?.kind ?? entry.context.agent?.kind;
    const allowCronTools = sessionContextIsCron(entry.context, session.context.state.session);
    const systemPrompt = await createSystemPrompt({
      provider: providerSettings?.id,
      model: providerSettings?.model,
      workspace: session.context.state.permissions.workingDir,
      writeDirs: session.context.state.permissions.writeDirs,
      web: session.context.state.permissions.web,
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
      skillsPrompt,
      agentKind,
      parentSessionId: session.context.state.agent?.parentSessionId ?? entry.context.agent?.parentSessionId,
      configDir: this.configDir
    });
    const context: Context = {
      ...sessionContext,
      tools: this.listContextTools(source, {
        agentKind,
        allowCronTools
      }),
      systemPrompt
    };
    logger.debug(
      `Context built toolCount=${context.tools?.length ?? 0} systemPrompt=${context.systemPrompt ? "set" : "none"}`
    );

    logger.debug("Building user message from entry");
    const userMessage = await messageBuildUser(entry);
    context.messages.push(userMessage);
    logger.debug(`User message added to context totalMessages=${context.messages.length}`);

    const providersForSession = providerId
      ? listActiveInferenceProviders(this.settings).filter((provider) => provider.id === providerId)
      : [];
    logger.debug(`Session provider resolved sessionId=${session.id} providerId=${providerId ?? "none"} providerCount=${providersForSession.length}`);

    let response: Awaited<ReturnType<InferenceRouter["complete"]>> | null = null;
    let toolLoopExceeded = false;
    const generatedFiles: FileReference[] = [];
    let lastResponseTextSent = false;
    logger.debug(`Starting typing indicator channelId=${entry.context.channelId}`);
    const stopTyping = connector?.startTyping?.(entry.context.channelId);

    try {
      logger.debug(`Starting inference loop maxIterations=${MAX_TOOL_ITERATIONS}`);
      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
        logger.debug(`Inference loop iteration=${iteration} sessionId=${session.id} messageCount=${context.messages.length}`);
        try {
          await this.sessionStore.recordModelContext(session, source, context, {
            messageId: entry.id,
            iteration
          });
        } catch (error) {
          logger.warn({ sessionId: session.id, source, messageId: entry.id, error }, "Session persistence failed");
        }
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

        const responseText = messageExtractText(response.message);
        const hasResponseText = !!responseText && responseText.trim().length > 0;
        lastResponseTextSent = false;
        if (hasResponseText && connector) {
          try {
            await connector.sendMessage(entry.context.channelId, {
              text: responseText,
              replyToMessageId: entry.context.messageId
            });
            await sessionRecordOutgoing({
              sessionStore: this.sessionStore,
              session,
              source,
              context: entry.context,
              text: responseText,
              origin: "model",
              logger
            });
            this.eventBus.emit("session.outgoing", {
              sessionId: session.id,
              source,
              message: { text: responseText },
              context: entry.context
            });
            lastResponseTextSent = true;
          } catch (error) {
            logger.warn({ connector: source, error }, "Failed to send response text");
          }
        }

        const toolCalls = messageExtractToolCalls(response.message);
        logger.debug(`Extracted tool calls from response toolCallCount=${toolCalls.length}`);
        if (toolCalls.length === 0) {
          logger.debug(`No tool calls, breaking inference loop iteration=${iteration}`);
          break;
        }

        for (const toolCall of toolCalls) {
          const argsPreview = JSON.stringify(toolCall.arguments).slice(0, 200);
          logger.debug(`Executing tool call toolName=${toolCall.name} toolCallId=${toolCall.id} args=${argsPreview}`);

          if (this.verbose && connector) {
            const argsFormatted = toolArgsFormatVerbose(toolCall.arguments);
            await connector.sendMessage(entry.context.channelId, {
              text: `[tool] ${toolCall.name}(${argsFormatted})`
            });
          }

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

          if (this.verbose && connector) {
            const resultText = toolResultFormatVerbose(toolResult);
            await connector.sendMessage(entry.context.channelId, {
              text: resultText
            });
          }

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
      await this.notifySubagentFailure(session, "Inference failed", error);
      if (connector) {
        await connector.sendMessage(entry.context.channelId, {
          text: message,
          replyToMessageId: entry.context.messageId
        });
        await sessionRecordOutgoing({
          sessionStore: this.sessionStore,
          session,
          source,
          context: entry.context,
          text: message,
          origin: "system",
          logger
        });
      }
      await sessionRecordState({
        sessionStore: this.sessionStore,
        session,
        source,
        logger
      });
      logger.debug("handleSessionMessage completed with error");
      return;
    } finally {
      logger.debug("Stopping typing indicator");
      stopTyping?.();
    }

    if (!response) {
      logger.debug("No response received, recording session state only");
      await sessionRecordState({
        sessionStore: this.sessionStore,
        session,
        source,
        logger
      });
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
      await this.notifySubagentFailure(session, "Inference failed", response.message.errorMessage);
      try {
        if (connector) {
          await connector.sendMessage(entry.context.channelId, {
            text: message,
            replyToMessageId: entry.context.messageId
          });
          await sessionRecordOutgoing({
            sessionStore: this.sessionStore,
            session,
            source,
            context: entry.context,
            text: message,
            origin: "system",
            logger
          });
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
        await sessionRecordState({
          sessionStore: this.sessionStore,
          session,
          source,
          logger
        });
        logger.debug("handleSessionMessage completed with error stop reason");
      }
      return;
    }

    const responseText = messageExtractText(response.message);
    const hasResponseText = !!responseText && responseText.trim().length > 0;
    logger.debug(`Extracted assistant text hasText=${hasResponseText} textLength=${responseText?.length ?? 0} generatedFileCount=${generatedFiles.length}`);

    if (!hasResponseText && generatedFiles.length === 0) {
      if (toolLoopExceeded) {
        const message = "Tool execution limit reached.";
        logger.debug("Tool loop exceeded, sending error message");
        await this.notifySubagentFailure(session, message);
        try {
          if (connector) {
            await connector.sendMessage(entry.context.channelId, {
              text: message,
              replyToMessageId: entry.context.messageId
            });
            await sessionRecordOutgoing({
              sessionStore: this.sessionStore,
              session,
              source,
              context: entry.context,
              text: message,
              origin: "system",
              logger
            });
          }
        } catch (error) {
          logger.warn({ connector: source, error }, "Failed to send tool error");
        }
      }
      await sessionRecordState({
        sessionStore: this.sessionStore,
        session,
        source,
        logger
      });
      logger.debug("handleSessionMessage completed with no response text");
      return;
    }

    const shouldSendText = hasResponseText && !lastResponseTextSent;
    const shouldSendFiles = generatedFiles.length > 0;
    const outgoingText =
      shouldSendText
        ? responseText
        : !hasResponseText && shouldSendFiles
          ? "Generated files."
          : null;
    logger.debug(`Sending response to user textLength=${outgoingText?.length ?? 0} fileCount=${generatedFiles.length} channelId=${entry.context.channelId}`);
    try {
      if (connector && (outgoingText || shouldSendFiles)) {
        await connector.sendMessage(entry.context.channelId, {
          text: outgoingText,
          files: shouldSendFiles ? generatedFiles : undefined,
          replyToMessageId: entry.context.messageId
        });
        logger.debug("Response sent successfully");
        await sessionRecordOutgoing({
          sessionStore: this.sessionStore,
          session,
          source,
          context: entry.context,
          text: outgoingText,
          files: shouldSendFiles ? generatedFiles : undefined,
          origin: "model",
          logger
        });
        this.eventBus.emit("session.outgoing", {
          sessionId: session.id,
          source,
          message: {
            text: outgoingText,
            files: shouldSendFiles ? generatedFiles : undefined
          },
          context: entry.context
        });
        logger.debug("Session outgoing event emitted");
      }
    } catch (error) {
      logger.debug(`Failed to send response error=${String(error)}`);
      logger.warn({ connector: source, error }, "Failed to send response");
    } finally {
      await sessionRecordState({
        sessionStore: this.sessionStore,
        session,
        source,
        logger
      });
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
}
