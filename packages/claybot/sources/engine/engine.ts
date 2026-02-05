import { getLogger } from "../log.js";
import { AgentSystem } from "./agents/agentSystem.js";
import { ModuleRegistry } from "./modules/moduleRegistry.js";
import type { AgentDescriptor, AgentTokenEntry, Config, MessageContext } from "@/types";
import { FileStore } from "../files/store.js";
import { InferenceRouter } from "./modules/inference/router.js";
import { PluginRegistry } from "./plugins/registry.js";
import { PluginManager } from "./plugins/manager.js";
import { buildPluginCatalog } from "./plugins/catalog.js";
import { ensureWorkspaceDir } from "./permissions.js";
import { getProviderDefinition, listActiveInferenceProviders } from "../providers/catalog.js";
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
import { buildPermissionGrantTool, buildPermissionRequestTool } from "./modules/tools/permissions.js";
import { buildSendFileTool } from "./modules/tools/send-file.js";
import { permanentAgentToolBuild } from "./modules/tools/permanentAgentToolBuild.js";
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
import { EngineEventBus } from "./ipc/events.js";
import { ProviderManager } from "../providers/manager.js";
import { agentDescriptorLabel } from "./agents/ops/agentDescriptorLabel.js";
import { agentDescriptorTargetResolve } from "./agents/ops/agentDescriptorTargetResolve.js";
import { permissionDescribeDecision } from "./permissions/permissionDescribeDecision.js";
import { InvalidateSync } from "../util/sync.js";
import { ReadWriteLock } from "../util/readWriteLock.js";
import { valueDeepEqual } from "../util/valueDeepEqual.js";
import { configLoad } from "../config/configLoad.js";

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
  readonly providerManager: ProviderManager;
  readonly agentSystem: AgentSystem;
  readonly crons: Crons;
  readonly heartbeats: Heartbeats;
  readonly inferenceRouter: InferenceRouter;
  readonly eventBus: EngineEventBus;
  private readonly runtimeLock: ReadWriteLock;
  private readonly reloadSync: InvalidateSync;

  constructor(options: EngineOptions) {
    logger.debug(`Engine constructor starting, dataDir=${options.config.dataDir}`);
    this.config = options.config;
    this.eventBus = options.eventBus;
    this.runtimeLock = new ReadWriteLock();
    this.reloadSync = new InvalidateSync(async () => {
      await this.reloadApplyLatest();
    });
    this.authStore = new AuthStore(this.config);
    this.fileStore = new FileStore(this.config);
    logger.debug(`AuthStore and FileStore initialized`);

    this.modules = new ModuleRegistry({
      onMessage: async (message, context, descriptor) => this.inReadLock(async () => {
        const connector = descriptor.type === "user" ? descriptor.connector : "unknown";
        logger.debug(
          `Connector message received: connector=${connector} type=${descriptor.type} text=${message.text?.length ?? 0}chars files=${message.files?.length ?? 0}`
        );
        await this.agentSystem.post(
          { descriptor },
          { type: "message", message, context }
        );
      }),
      onCommand: async (command, context, descriptor) => this.inReadLock(async () => {
        const connector = descriptor.type === "user" ? descriptor.connector : "unknown";
        const parsed = parseCommand(command);
        if (!parsed) {
          return;
        }
        if (parsed.name === "reset") {
          if (descriptor.type !== "user") {
            return;
          }
          logger.info(
            { connector, channelId: descriptor.channelId, userId: descriptor.userId },
            "Reset command received"
          );
          await this.agentSystem.post(
            { descriptor },
            { type: "reset", message: "Manual reset requested by the user." }
          );
          return;
        }
        if (parsed.name === "context") {
          if (descriptor.type !== "user") {
            return;
          }
          logger.info(
            { connector, channelId: descriptor.channelId, userId: descriptor.userId },
            "Context command received"
          );
          await this.handleContextCommand(descriptor, context);
          return;
        }
        logger.debug({ connector, command: parsed.name }, "Unknown command ignored");
      }),
      onPermission: async (decision, context, descriptor) => this.inReadLock(async () => {
        if (decision.agentId) {
          await this.agentSystem.post(
            { agentId: decision.agentId },
            { type: "permission", decision, context }
          );
          const requester = this.agentSystem.getAgentDescriptor(decision.agentId);
          if (!requester || requester.type !== "user") {
            const status = decision.approved ? "approved" : "denied";
            const permissionLabel = permissionDescribeDecision(decision.access);
            const agentLabel = requester ? agentDescriptorLabel(requester) : "agent";
            const notice = [
              `User ${status} ${permissionLabel} for background agent "${agentLabel}" (${decision.agentId}).`,
              "Decision delivered to background agent."
            ].join("\n");
            await this.agentSystem.post(
              { descriptor },
              {
                type: "system_message",
                text: notice,
                origin: decision.agentId,
                context,
                silent: true
              }
            );
          }
          return;
        }
        await this.agentSystem.post(
          { descriptor },
          { type: "permission", decision, context }
        );
      }),
      onFatal: (source, reason, error) => {
        logger.warn({ source, reason, error }, "Connector requested shutdown");
      }
    });

    this.inferenceRouter = new InferenceRouter({
      providers: listActiveInferenceProviders(this.config.settings),
      registry: this.modules.inference,
      auth: this.authStore,
      // Hold read lock for the full inference lifecycle so write-locked reload reaches
      // a strict quiescent point with no active model calls.
      runWithReadLock: async (operation) => this.inReadLock(operation)
    });

    this.pluginRegistry = new PluginRegistry(this.modules);

    this.pluginManager = new PluginManager({
      config: this.config,
      registry: this.pluginRegistry,
      auth: this.authStore,
      fileStore: this.fileStore,
      pluginCatalog: buildPluginCatalog(),
      inferenceRouter: this.inferenceRouter,
      engineEvents: this.eventBus,
      onEvent: (event) => {
        this.agentSystem.eventBus.emit("plugin.event", event);
      }
    });

    this.providerManager = new ProviderManager({
      config: this.config,
      auth: this.authStore,
      fileStore: this.fileStore,
      inferenceRegistry: this.modules.inference,
      imageRegistry: this.modules.images
    });

    this.agentSystem = new AgentSystem({
      config: this.config,
      eventBus: this.eventBus,
      connectorRegistry: this.modules.connectors,
      imageRegistry: this.modules.images,
      toolResolver: this.modules.tools,
      pluginManager: this.pluginManager,
      inferenceRouter: this.inferenceRouter,
      fileStore: this.fileStore,
      authStore: this.authStore,
      runWithReadLock: async (operation) => this.inReadLock(operation)
    });

    this.crons = new Crons({
      config: this.config,
      eventBus: this.eventBus,
      agentSystem: this.agentSystem,
      runWithReadLock: async (operation) => this.inReadLock(operation)
    });
    this.agentSystem.setCrons(this.crons);

    const heartbeats = new Heartbeats({
      config: this.config,
      eventBus: this.eventBus,
      intervalMs: 30 * 60 * 1000,
      agentSystem: this.agentSystem,
      runWithReadLock: async (operation) => this.inReadLock(operation)
    });
    this.heartbeats = heartbeats;
    this.agentSystem.setHeartbeats(heartbeats);

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
    logger.debug("Plugins loaded");

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
    this.modules.tools.register("core", permanentAgentToolBuild());
    this.modules.tools.register("core", buildImageGenerationTool(this.modules.images));
    this.modules.tools.register("core", buildReactionTool());
    this.modules.tools.register("core", buildSendFileTool());
    this.modules.tools.register("core", buildPermissionRequestTool());
    this.modules.tools.register("core", buildPermissionGrantTool());
    logger.debug(
      "Core tools registered: cron, cron_memory, heartbeat, background, permanent_agents, image_generation, reaction, send_file, request_permission, grant_permission"
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
    this.reloadSync.stop();
    await this.modules.connectors.unregisterAll("shutdown");
    this.crons.stop();
    this.heartbeats.stop();
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

  private async handleContextCommand(
    descriptor: AgentDescriptor,
    context: MessageContext
  ): Promise<void> {
    const target = agentDescriptorTargetResolve(descriptor);
    if (!target) {
      return;
    }
    const connector = this.modules.connectors.get(target.connector);
    if (!connector?.capabilities.sendText) {
      return;
    }
    let tokens: AgentTokenEntry | null = null;
    try {
      tokens = await this.agentSystem.tokensForTarget({ descriptor });
    } catch (error) {
      logger.warn({ connector: target.connector, error }, "Context command failed to load tokens");
    }
    const text = contextCommandTextBuild(tokens);
    try {
      await connector.sendMessage(target.targetId, {
        text,
        replyToMessageId: context.messageId
      });
    } catch (error) {
      logger.warn({ connector: target.connector, error }, "Context command failed to send response");
    }
  }

  async reload(): Promise<void> {
    await this.reloadSync.invalidateAndAwait();
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

  private async inReadLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.runtimeLock.inReadLock(operation);
  }

  private async reloadApplyLatest(): Promise<void> {
    const config = await configLoad(this.config.settingsPath, { verbose: this.config.verbose });
    await this.runtimeLock.inWriteLock(async () => {
      if (!this.isReloadable(config)) {
        throw new Error("Config reload requires restart (paths changed).");
      }
      if (configReloadEqual(this.config, config)) {
        logger.debug("Reload requested but config is unchanged.");
        return;
      }
      this.config = config;
      this.agentSystem.reload(config);
      this.pluginManager.reload(config);
      await ensureWorkspaceDir(this.config.defaultPermissions.workingDir);
      this.providerManager.reload(config);
      await this.providerManager.sync();
      await this.pluginManager.syncWithConfig(this.config);
      this.inferenceRouter.updateProviders(listActiveInferenceProviders(this.config.settings));
      logger.info("Runtime configuration reloaded");
    });
  }

}

function parseCommand(command: string): { name: string; args: string[] } | null {
  const trimmed = command.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const body = trimmed.slice(1);
  if (!body) {
    return null;
  }
  const parts = body.split(/\s+/);
  const rawName = parts.shift() ?? "";
  const name = rawName.split("@")[0] ?? "";
  if (!name) {
    return null;
  }
  return { name, args: parts };
}

function contextCommandTextBuild(tokens: AgentTokenEntry | null): string {
  if (!tokens) {
    return "Context size unavailable yet. Run a prompt to capture token usage.";
  }
  const { size } = tokens;
  return [
    `Context size (${tokens.provider}/${tokens.model})`,
    `total: ${size.total} tokens`,
    `input: ${size.input} tokens`,
    `output: ${size.output} tokens`,
    `cache read: ${size.cacheRead} tokens`,
    `cache write: ${size.cacheWrite} tokens`
  ].join("\n");
}

function configReloadEqual(left: Config, right: Config): boolean {
  return (
    left.settingsPath === right.settingsPath &&
    left.configDir === right.configDir &&
    left.dataDir === right.dataDir &&
    left.agentsDir === right.agentsDir &&
    left.filesDir === right.filesDir &&
    left.authPath === right.authPath &&
    left.socketPath === right.socketPath &&
    left.workspaceDir === right.workspaceDir &&
    left.verbose === right.verbose &&
    valueDeepEqual(left.settings, right.settings) &&
    valueDeepEqual(left.defaultPermissions, right.defaultPermissions)
  );
}
