import { createId } from "@paralleldrive/cuid2";
import type { ToolCall } from "@mariozechner/pi-ai";

import { getLogger } from "../log.js";
import { AgentSystem } from "./agents/agentSystem.js";
import { ModuleRegistry } from "./modules/moduleRegistry.js";
import type {
  AgentRuntime,
  AgentState,
  Config,
  MessageContext,
  ToolExecutionResult
} from "@/types";
import { FileStore } from "../files/store.js";
import { InferenceRouter } from "./modules/inference/router.js";
import { PluginRegistry } from "./plugins/registry.js";
import { PluginEventEngine } from "./plugins/event-engine.js";
import { PluginEventQueue } from "./plugins/events.js";
import { PluginManager } from "./plugins/manager.js";
import { buildPluginCatalog } from "./plugins/catalog.js";
import { ensureWorkspaceDir } from "./permissions.js";
import { permissionClone } from "./permissions/permissionClone.js";
import { getProviderDefinition, listActiveInferenceProviders } from "../providers/catalog.js";
import { Agent } from "./agents/agent.js";
import { AgentInbox } from "./agents/ops/agentInbox.js";
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
import { buildSendAgentMessageTool, buildStartBackgroundAgentTool } from "./modules/tools/background.js";
import { Crons } from "./cron/crons.js";
import { Heartbeats } from "./heartbeat/heartbeats.js";
import { toolListContextBuild } from "./modules/tools/toolListContextBuild.js";
import { agentDescriptorBuild } from "./agents/ops/agentDescriptorBuild.js";
import { EngineEventBus } from "./ipc/events.js";
import { ProviderManager } from "../providers/manager.js";

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
        void this.agentSystem.schedulePermissionDecision(source, decision, context);
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

    this.pluginRegistry = new PluginRegistry(this.modules);

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
      config: this.config,
      auth: this.authStore,
      fileStore: this.fileStore,
      inferenceRegistry: this.modules.inference,
      imageRegistry: this.modules.images
    });

    let agentSystem!: AgentSystem;
    this.crons = new Crons({
      config: this.config,
      eventBus: this.eventBus,
      onTask: async (task, context) => {
        const descriptor = { type: "cron" as const, id: task.taskUid };
        const messageContext: MessageContext = {
          channelId: context.channelId,
          userId: context.userId
        };
        logger.debug(
          `CronScheduler.onTask triggered channelId=${messageContext.channelId} taskUid=${task.taskUid}`
        );
        await agentSystem.post(
          { descriptor },
          {
            type: "message",
            source: "cron",
            message: { text: task.prompt },
            context: messageContext
          }
        );
      }
    });
    this.heartbeats = new Heartbeats({
      config: this.config,
      eventBus: this.eventBus,
      intervalMs: 30 * 60 * 1000,
      runtime: {
        postHeartbeat: async ({ prompt }) => {
          await agentSystem.post(
            { descriptor: { type: "heartbeat" } },
            {
              type: "message",
              source: "heartbeat",
              message: { text: prompt },
              context: { channelId: "heartbeat", userId: "heartbeat" }
            }
          );
        }
      }
    });

    const agentRuntime: AgentRuntime = {
      startBackgroundAgent: (args) => agentSystem.startBackgroundAgent(args),
      sendAgentMessage: (args) => agentSystem.sendAgentMessage(args),
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

    logger.debug("Loading agents");
    await this.agentSystem.load();
    logger.debug("Agents loaded");

    logger.debug("Syncing provider manager with settings");
    await this.providerManager.sync();
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
    this.modules.tools.register("core", buildSendAgentMessageTool());
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

  resetAgent(agentId: string): boolean {
    return this.agentSystem.resetAgent(agentId);
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
    const now = Date.now();
    const agentId = createId();
    const context: MessageContext = {
      channelId: messageContext?.channelId ?? agentId,
      userId: messageContext?.userId ?? "system",
      messageId: messageContext?.messageId
    };
    const descriptor = agentDescriptorBuild("system", context, agentId);
    const state: AgentState = {
      context: { messages: [] },
      providerId: null,
      permissions: permissionClone(this.agentSystem.config.defaultPermissions),
      routing: null,
      agent: null,
      createdAt: now,
      updatedAt: now
    };
    const agent = Agent.restore(agentId, descriptor, state, new AgentInbox(agentId), this.agentSystem);

    return this.modules.tools.execute(toolCall, {
      connectorRegistry: this.modules.connectors,
      fileStore: this.fileStore,
      auth: this.authStore,
      logger,
      assistant: this.agentSystem.config.settings.assistant ?? null,
      permissions: agent.state.permissions,
      agent,
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
    this.providerManager.reload(config);
    await this.providerManager.sync();
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

}
