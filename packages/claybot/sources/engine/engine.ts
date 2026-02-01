import { createId } from "@paralleldrive/cuid2";
import type { ToolCall } from "@mariozechner/pi-ai";
import path from "node:path";

import { getLogger } from "../log.js";
import { AgentSystem } from "./agents/agentSystem.js";
import { ModuleRegistry } from "./modules/moduleRegistry.js";
import type { MessageContext, PermissionDecision } from "./modules/connectors/types.js";
import { FileStore } from "../files/store.js";
import { InferenceRouter } from "./modules/inference/router.js";
import { PluginRegistry } from "./plugins/registry.js";
import { PluginEventEngine } from "./plugins/event-engine.js";
import { PluginEventQueue } from "./plugins/events.js";
import { PluginManager } from "./plugins/manager.js";
import { buildPluginCatalog } from "./plugins/catalog.js";
import { ensureWorkspaceDir } from "./permissions.js";
import { permissionApply } from "./permissions/permissionApply.js";
import { permissionClone } from "./permissions/permissionClone.js";
import { permissionDescribeDecision } from "./permissions/permissionDescribeDecision.js";
import { permissionFormatTag } from "./permissions/permissionFormatTag.js";
import { getProviderDefinition, listActiveInferenceProviders } from "../providers/catalog.js";
import { Session } from "./sessions/session.js";
import { AuthStore } from "../auth/store.js";
import {
  buildCronDeleteTaskTool,
  buildCronReadTaskTool,
  buildCronReadMemoryTool,
  buildCronTool,
  buildCronWriteMemoryTool
} from "./modules/tools/cron.js";
import { buildImageGenerationTool } from "./modules/tools/image-generation.js";
import { buildReactionTool } from "./modules/tools/reaction.js";
import { buildPermissionRequestTool } from "./modules/tools/permissions.js";
import { buildSendFileTool } from "./modules/tools/send-file.js";
import {
  buildHeartbeatAddTool,
  buildHeartbeatListTool,
  buildHeartbeatRemoveTool,
  buildHeartbeatRunTool
} from "./modules/tools/heartbeat.js";
import { buildSendSessionMessageTool, buildStartBackgroundAgentTool } from "./modules/tools/background.js";
import { cuid2Is } from "../utils/cuid2Is.js";
import type { AgentRuntime, ToolExecutionResult } from "./modules/tools/types.js";
import { Crons } from "./cron/crons.js";
import { Heartbeats } from "./heartbeat/heartbeats.js";
import { toolListContextBuild } from "./modules/tools/toolListContextBuild.js";
import { sessionDescriptorBuild } from "./sessions/sessionDescriptorBuild.js";
import type { SessionState } from "./sessions/sessionStateTypes.js";
import { EngineEventBus } from "./ipc/events.js";
import { ProviderManager } from "../providers/manager.js";
import type { Config } from "../config/configTypes.js";

const logger = getLogger("engine.runtime");

export type EngineOptions = {
  config: Config;
  eventBus: EngineEventBus;
};

export class Engine {
  config: Config;
  readonly authStore: AuthStore;
  readonly fileStore: FileStore;
  readonly modules: ModuleRegistry;
  readonly pluginRegistry: PluginRegistry;
  readonly pluginManager: PluginManager;
  readonly pluginEventQueue: PluginEventQueue;
  readonly pluginEventEngine: PluginEventEngine;
  readonly providerManager: ProviderManager;
  readonly agentSystem: AgentSystem;
  readonly agentRuntime: AgentRuntime;
  readonly crons: Crons;
  readonly heartbeats: Heartbeats;
  readonly inferenceRouter: InferenceRouter;
  readonly eventBus: EngineEventBus;

  constructor(options: EngineOptions) {
    logger.debug(`Engine constructor starting, dataDir=${options.config.dataDir}`);
    this.config = options.config;
    this.eventBus = options.eventBus;
    this.authStore = new AuthStore(this.config);
    this.fileStore = new FileStore(this.config);
    logger.debug(`AuthStore and FileStore initialized`);

    this.pluginEventQueue = new PluginEventQueue();
    this.pluginEventEngine = new PluginEventEngine(this.pluginEventQueue);

    this.modules = new ModuleRegistry({
      onMessage: (source, message, context) => {
        if (!context.channelId || !context.userId) {
          logger.error(
            { source, channelId: context.channelId, userId: context.userId },
            "Connector message missing channelId or userId"
          );
          return;
        }
        logger.debug(`Connector message received: source=${source} channel=${context.channelId} text=${message.text?.length ?? 0}chars files=${message.files?.length ?? 0}`);
        void this.agentSystem.scheduleMessage(source, message, context);
      },
      onPermission: (source, decision, context) => {
        void this.handlePermissionDecision(source, decision, context);
      },
      onFatal: (source, reason, error) => {
        logger.warn({ source, reason, error }, "Connector requested shutdown");
      }
    });

    this.inferenceRouter = new InferenceRouter({
      providers: listActiveInferenceProviders(this.config.settings),
      registry: this.modules.inference,
      auth: this.authStore
    });

    this.pluginRegistry = new PluginRegistry(
      this.modules.connectors,
      this.modules.inference,
      this.modules.images,
      this.modules.tools
    );

    this.pluginManager = new PluginManager({
      config: this.config,
      registry: this.pluginRegistry,
      auth: this.authStore,
      fileStore: this.fileStore,
      pluginCatalog: buildPluginCatalog(),
      eventQueue: this.pluginEventQueue,
      inferenceRouter: this.inferenceRouter,
      engineEvents: this.eventBus
    });

    this.providerManager = new ProviderManager({
      settings: this.config.settings,
      auth: this.authStore,
      fileStore: this.fileStore,
      inferenceRegistry: this.modules.inference,
      imageRegistry: this.modules.images
    });

    let agentSystem!: AgentSystem;
    this.crons = new Crons({
      basePath: path.join(this.config.configDir, "cron"),
      eventBus: this.eventBus,
      onTask: async (task, context) => {
        const messageContext = agentSystem.withProviderContext({
          ...context,
          cron: {
            taskId: task.taskId,
            taskUid: task.taskUid,
            taskName: task.taskName,
            memoryPath: task.memoryPath,
            filesPath: task.filesPath
          }
        });
        logger.debug(
          `CronScheduler.onTask triggered channelId=${messageContext.channelId} sessionId=${messageContext.sessionId}`
        );
        await agentSystem.startBackgroundAgent({
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
      }
    });
    this.heartbeats = new Heartbeats({
      basePath: path.join(this.config.configDir, "heartbeat"),
      eventBus: this.eventBus,
      intervalMs: 30 * 60 * 1000,
      runtime: {
        resolveSessionId: () =>
          agentSystem.resolveSessionId("heartbeat") ??
          agentSystem.getOrCreateSessionIdForDescriptor({ type: "heartbeat" }),
        startBackgroundAgent: (args) => agentSystem.startBackgroundAgent(args)
      }
    });

    const agentRuntime: AgentRuntime = {
      startBackgroundAgent: (args) => agentSystem.startBackgroundAgent(args),
      sendSessionMessage: (args) => agentSystem.sendSessionMessage(args),
      runHeartbeatNow: (args) => this.heartbeats.runNow(args),
      addHeartbeatTask: (args) => this.heartbeats.addTask(args),
      listHeartbeatTasks: () => this.heartbeats.listTasks(),
      removeHeartbeatTask: async (args) => ({
        removed: await this.heartbeats.removeTask(args.id)
      })
    };
    agentSystem = new AgentSystem({
      config: this.config,
      eventBus: this.eventBus,
      connectorRegistry: this.modules.connectors,
      imageRegistry: this.modules.images,
      toolResolver: this.modules.tools,
      pluginManager: this.pluginManager,
      inferenceRouter: this.inferenceRouter,
      fileStore: this.fileStore,
      authStore: this.authStore,
      crons: this.crons,
      agentRuntime
    });
    this.agentSystem = agentSystem;
    this.agentRuntime = agentRuntime;

  }

  async start(): Promise<void> {
    logger.debug("Engine.start() beginning");
    await ensureWorkspaceDir(this.config.defaultPermissions.workingDir);

    logger.debug("Loading agent sessions");
    await this.agentSystem.load();
    this.agentSystem.enableScheduling();
    logger.debug("Agent sessions loaded");

    logger.debug("Syncing provider manager with settings");
    await this.providerManager.sync(this.config.settings);
    logger.debug("Provider manager sync complete");
    logger.debug("Loading enabled plugins");
    await this.pluginManager.loadEnabled(this.config);
    logger.debug("Plugins loaded, starting plugin event engine");
    this.pluginEventEngine.start();
    logger.debug("Plugin event engine started");

    await this.crons.ensureDir();
    await this.heartbeats.ensureDir();

    logger.debug("Registering core tools");
    this.modules.tools.register("core", buildCronTool(this.crons));
    this.modules.tools.register("core", buildCronReadTaskTool(this.crons));
    this.modules.tools.register("core", buildCronReadMemoryTool(this.crons));
    this.modules.tools.register("core", buildCronWriteMemoryTool(this.crons));
    this.modules.tools.register("core", buildCronDeleteTaskTool(this.crons));
    this.modules.tools.register("core", buildHeartbeatRunTool());
    this.modules.tools.register("core", buildHeartbeatAddTool());
    this.modules.tools.register("core", buildHeartbeatListTool());
    this.modules.tools.register("core", buildHeartbeatRemoveTool());
    this.modules.tools.register("core", buildStartBackgroundAgentTool());
    this.modules.tools.register("core", buildSendSessionMessageTool());
    this.modules.tools.register("core", buildImageGenerationTool(this.modules.images));
    this.modules.tools.register("core", buildReactionTool());
    this.modules.tools.register("core", buildSendFileTool());
    this.modules.tools.register("core", buildPermissionRequestTool());
    logger.debug(
      "Core tools registered: cron, cron_memory, heartbeat, background, image_generation, reaction, send_file, request_permission"
    );

    logger.debug("Starting agent system");
    await this.agentSystem.start();
    logger.debug("Agent system started");

    logger.debug("Starting cron scheduler");
    await this.crons.start();
    logger.debug("Starting heartbeat scheduler");
    await this.heartbeats.start();
    logger.debug("Engine.start() complete");
  }

  async shutdown(): Promise<void> {
    await this.modules.connectors.unregisterAll("shutdown");
    this.crons.stop();
    this.heartbeats.stop();
    this.pluginEventEngine.stop();
    await this.pluginManager.unloadAll();
  }

  getStatus() {
    const plugins = this.pluginManager.listLoadedDetails();
    const pluginByInstance = new Map(plugins.map((plugin) => [plugin.id, plugin]));

    return {
      plugins,
      providers: this.providerManager.listLoadedDetails(),
      connectors: this.modules.connectors.listStatus().map((connector) => {
        const plugin = pluginByInstance.get(connector.id);
        return {
          id: connector.id,
          name: plugin?.name ?? connector.id,
          pluginId: plugin?.pluginId,
          loadedAt: connector.loadedAt
        };
      }),
      inferenceProviders: this.modules.inference.list().map((provider) => {
        const definition = getProviderDefinition(provider.id);
        return {
          id: provider.id,
          name: provider.label ?? definition?.name ?? provider.id,
          label: provider.label
        };
      }),
      imageProviders: this.modules.images.list().map((provider) => {
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

  resetSessionByStorageId(storageId: string): boolean {
    return this.agentSystem.resetSessionByStorageId(storageId);
  }

  resetSession(sessionId: string): boolean {
    return this.agentSystem.resetSession(sessionId);
  }

  private listContextTools(
    source?: string,
    options?: { agentKind?: "background" | "foreground"; allowCronTools?: boolean }
  ) {
    return toolListContextBuild({
      tools: this.modules.tools.listTools(),
      source,
      agentKind: options?.agentKind,
      allowCronTools: options?.allowCronTools,
      connectorRegistry: this.modules.connectors,
      imageRegistry: this.modules.images
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
          permissions: permissionClone(this.config.defaultPermissions),
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

    return this.modules.tools.execute(toolCall, {
      connectorRegistry: this.modules.connectors,
      fileStore: this.fileStore,
      auth: this.authStore,
      logger,
      assistant: this.config.settings.assistant ?? null,
      permissions: session.context.state.permissions,
      session,
      source: "system",
      messageContext: context,
      agentRuntime: this.agentRuntime
    });
  }

  async reload(config: Config): Promise<void> {
    if (!this.isReloadable(config)) {
      throw new Error("Config reload requires restart (paths changed).");
    }
    this.config = config;
    this.agentSystem.reload(config);
    this.pluginManager.reload(config);
    await ensureWorkspaceDir(this.config.defaultPermissions.workingDir);
    await this.providerManager.sync(this.config.settings);
    await this.pluginManager.syncWithConfig(this.config);
    this.inferenceRouter.updateProviders(listActiveInferenceProviders(this.config.settings));
  }

  private isReloadable(next: Config): boolean {
    return (
      this.config.settingsPath === next.settingsPath &&
      this.config.configDir === next.configDir &&
      this.config.dataDir === next.dataDir &&
      this.config.authPath === next.authPath &&
      this.config.socketPath === next.socketPath
    );
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
    const connector = this.modules.connectors.get(source);
    const permissionTag = permissionFormatTag(decision.access);
    const permissionLabel = permissionDescribeDecision(decision.access);
    const sessionId = this.agentSystem.resolveSessionIdForContext(source, context);

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

    const session = this.agentSystem.getSessionById(sessionId);
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
        await this.agentSystem.sessionStore.recordState(session);
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
    await this.agentSystem.scheduleMessage(
      source,
      { text: resumeText },
      { ...context, sessionId: session.id }
    );
  }

}
