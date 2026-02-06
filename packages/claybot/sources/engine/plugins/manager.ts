import path from "node:path";
import { promises as fs } from "node:fs";

import { ZodError } from "zod";
import { createId } from "@paralleldrive/cuid2";

import { getLogger } from "../../log.js";
import type { FileStore } from "../../files/store.js";
import type { AuthStore } from "../../auth/store.js";
import type { PluginInstanceSettings, SettingsConfig } from "../../settings.js";
import { listEnabledPlugins } from "../../settings.js";
import type { PluginEvent, PluginEventInput } from "./events.js";
import { PluginModuleLoader } from "./loader.js";
import type { PluginDefinition } from "./catalog.js";
import type { PluginApi, PluginInstance, PluginModule } from "@/types";
import type { PluginRegistry } from "./registry.js";
import type { EngineEventBus } from "../ipc/events.js";
import { resolveExclusivePlugins } from "./exclusive.js";
import type { InferenceRouter } from "../modules/inference/router.js";
import { PluginInferenceService } from "./inference.js";
import { valueDeepEqual } from "../../util/valueDeepEqual.js";
import type { ConfigModule } from "../config/configModule.js";

export type PluginManagerOptions = {
  config: ConfigModule;
  registry: PluginRegistry;
  auth: AuthStore;
  fileStore: FileStore;
  pluginCatalog: Map<string, PluginDefinition>;
  inferenceRouter: InferenceRouter;
  mode?: "runtime" | "validate";
  engineEvents?: EngineEventBus;
  onEvent?: (event: PluginEvent) => void;
};

type LoadedPlugin = {
  module: PluginModule;
  instance: PluginInstance;
  config: PluginInstanceSettings;
  registrar: ReturnType<PluginRegistry["createRegistrar"]>;
  dataDir: string;
  settings: unknown;
};

export class PluginManager {
  private readonly config: ConfigModule;
  private registry: PluginRegistry;
  private auth: AuthStore;
  private fileStore: FileStore;
  private pluginCatalog: Map<string, PluginDefinition>;
  private mode: "runtime" | "validate";
  private engineEvents?: EngineEventBus;
  private onEvent: ((event: PluginEvent) => void) | null;
  private inference: PluginInferenceService;
  private loaded = new Map<string, LoadedPlugin>();
  private logger = getLogger("plugins.manager");

  constructor(options: PluginManagerOptions) {
    this.config = options.config;
    this.registry = options.registry;
    this.auth = options.auth;
    this.fileStore = options.fileStore;
    this.pluginCatalog = options.pluginCatalog;
    this.mode = options.mode ?? "runtime";
    this.engineEvents = options.engineEvents;
    this.onEvent = options.onEvent ?? null;
    this.inference = new PluginInferenceService({
      router: options.inferenceRouter,
      config: this.config
    });
    this.logger.debug(`PluginManager initialized catalogSize=${options.pluginCatalog.size} dataDir=${this.config.current.dataDir} mode=${this.mode}`);
  }

  listLoaded(): string[] {
    return Array.from(this.loaded.keys());
  }

  listLoadedDetails(): Array<{ id: string; pluginId: string; name: string }> {
    return Array.from(this.loaded.entries()).map(([instanceId, entry]) => {
      const pluginId = entry.config.pluginId;
      const name = this.pluginCatalog.get(pluginId)?.descriptor.name ?? pluginId;
      return {
        id: instanceId,
        pluginId,
        name
      };
    });
  }

  listAvailable(): string[] {
    return Array.from(this.pluginCatalog.keys());
  }

  listRegisteredSkills(): Array<{ pluginId: string; path: string }> {
    const results: Array<{ pluginId: string; path: string }> = [];
    const seen = new Set<string>();
    for (const entry of this.loaded.values()) {
      for (const skillPath of entry.registrar.listSkills()) {
        const key = `${entry.config.pluginId}:${skillPath}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        results.push({ pluginId: entry.config.pluginId, path: skillPath });
      }
    }
    return results;
  }

  async getSystemPrompts(): Promise<string[]> {
    const prompts: string[] = [];
    for (const entry of this.loaded.values()) {
      const candidate = entry.instance.systemPrompt;
      if (!candidate) {
        continue;
      }
      try {
        const value =
          typeof candidate === "function" ? await candidate() : candidate;
        if (typeof value === "string" && value.trim().length > 0) {
          prompts.push(value.trim());
        }
      } catch (error) {
        this.logger.warn({ error }, "Plugin system prompt failed");
      }
    }
    return prompts;
  }

  async reload(): Promise<void> {
    this.logger.debug(`reload() starting loadedCount=${this.loaded.size}`);
    const settings = this.config.current.settings;
    const desired = this.resolveEnabledPlugins(settings);
    const desiredMap = new Map(desired.map((plugin) => [plugin.instanceId, plugin]));
    const desiredIds = desired.map(p => p.instanceId).join(",");
    this.logger.debug(`Desired plugins from settings desiredCount=${desired.length} desiredIds=${desiredIds}`);

    for (const [instanceId, entry] of this.loaded) {
      const next = desiredMap.get(instanceId);
      if (!next) {
        this.logger.debug(`Plugin no longer desired, unloading instanceId=${instanceId}`);
        this.logger.info({ instance: instanceId }, "Unloading plugin (disabled)");
        await this.unload(instanceId);
        continue;
      }
      if (
        next.pluginId !== entry.config.pluginId ||
        !valueDeepEqual(next.settings ?? {}, entry.config.settings ?? {})
      ) {
        this.logger.debug(`Plugin settings changed, reloading instanceId=${instanceId} oldPluginId=${entry.config.pluginId} newPluginId=${next.pluginId}`);
        this.logger.info(
          { instance: instanceId, plugin: entry.config.pluginId },
          "Reloading plugin (settings changed)"
        );
        await this.unload(instanceId);
      }
    }

    for (const plugin of desired) {
      if (this.loaded.has(plugin.instanceId)) {
        const entry = this.loaded.get(plugin.instanceId);
        if (entry) {
          this.logger.debug(`Plugin already loaded, updating config instanceId=${plugin.instanceId}`);
          try {
            const parsed = entry.module.settingsSchema.parse(plugin.settings ?? {});
            entry.config = plugin;
            entry.settings = parsed;
          } catch (error) {
            if (error instanceof ZodError) {
              this.logger.warn(
                { instance: plugin.instanceId, plugin: plugin.pluginId, error },
                "Plugin settings validation failed"
              );
              await this.unload(plugin.instanceId);
              if (this.mode === "validate") {
                throw error;
              }
              continue;
            }
            throw error;
          }
        }
        continue;
      }
      this.logger.debug(`Loading new plugin pluginId=${plugin.pluginId} instanceId=${plugin.instanceId}`);
      this.logger.info(
        { plugin: plugin.pluginId, instance: plugin.instanceId },
        "Loading plugin (settings reload)"
      );
      await this.load(plugin);
    }
    this.logger.debug(`reload() complete loadedCount=${this.loaded.size}`);
  }

  getConfig(instanceId: string): PluginInstanceSettings | null {
    return this.loaded.get(instanceId)?.config ?? null;
  }

  async load(pluginConfig: PluginInstanceSettings): Promise<void> {
    const instanceId = pluginConfig.instanceId;
    this.logger.debug(`load() called pluginId=${pluginConfig.pluginId} instanceId=${instanceId}`);

    if (this.loaded.has(instanceId)) {
      this.logger.info({ instance: instanceId }, "Plugin already loaded, reloading instance");
      await this.unload(instanceId);
    }

    const definition = this.pluginCatalog.get(pluginConfig.pluginId);
    if (!definition) {
      const catalogKeys = Array.from(this.pluginCatalog.keys()).join(",");
      this.logger.debug(`Plugin not found in catalog pluginId=${pluginConfig.pluginId} catalogKeys=${catalogKeys}`);
      this.logger.warn(
        { plugin: pluginConfig.pluginId, instance: instanceId },
        "Unknown plugin - skipping"
      );
      return;
    }

    this.logger.info(
      { plugin: pluginConfig.pluginId, instance: instanceId },
      "Loading plugin"
    );

    this.logger.debug(`Loading plugin module entryPath=${definition.entryPath}`);
    const loader = new PluginModuleLoader(`plugin:${instanceId}`);
    const { module } = await loader.load(definition.entryPath);
    this.logger.debug("Plugin module loaded, parsing settings");
    let parsedSettings: unknown;
    try {
      parsedSettings = module.settingsSchema.parse(pluginConfig.settings ?? {});
    } catch (error) {
      if (error instanceof ZodError) {
        this.logger.warn(
          { plugin: pluginConfig.pluginId, instance: instanceId, error },
          "Plugin settings validation failed"
        );
        if (this.mode === "validate") {
          throw error;
        }
        return;
      }
      throw error;
    }
    this.logger.debug("Settings parsed successfully");

    this.logger.debug("Creating registrar");
    const registrar = this.registry.createRegistrar(instanceId);
    this.logger.debug("Ensuring plugin data directory");
    const dataDir = await this.ensurePluginDir(instanceId);
    this.logger.debug(`Plugin data directory ready dataDir=${dataDir}`);

    this.logger.debug("Building plugin API");
    const api: PluginApi = {
      instance: pluginConfig,
      settings: parsedSettings,
      engineSettings: this.config.current.settings,
      logger: getLogger(`plugin.${instanceId}`),
      auth: this.auth,
      dataDir,
      registrar,
      fileStore: this.fileStore,
      inference: this.inference.createClient(instanceId),
      mode: this.mode,
      engineEvents: this.engineEvents,
      events: {
        emit: (event) => {
          this.logger.debug(`Plugin emitting event instanceId=${instanceId} eventType=${event.type}`);
          this.onEvent?.(buildPluginEvent({ pluginId: pluginConfig.pluginId, instanceId }, event));
        }
      }
    };

    try {
      this.logger.debug("Creating plugin instance");
      const instance = await module.create(api);
      this.logger.debug("Plugin instance created");
      this.logger.debug("Calling plugin.load()");
      await instance.load?.();
      this.loaded.set(instanceId, {
        module,
        instance,
        config: pluginConfig,
        registrar,
        dataDir,
        settings: parsedSettings
      });
      this.logger.debug(`Plugin registered in loaded map instanceId=${instanceId} loadedCount=${this.loaded.size}`);
      this.logger.info(
        { plugin: pluginConfig.pluginId, instance: instanceId },
        "Plugin loaded"
      );
    } catch (error) {
      this.logger.debug(`Plugin load failed, cleaning up instanceId=${instanceId} error=${String(error)}`);
      await registrar.unregisterAll();
      throw error;
    }
  }

  async unload(instanceId: string): Promise<void> {
    this.logger.debug(`unload() called instanceId=${instanceId}`);
    const entry = this.loaded.get(instanceId);
    if (!entry) {
      this.logger.debug(`Plugin not loaded, nothing to unload instanceId=${instanceId}`);
      return;
    }

    this.logger.info(
      { instance: instanceId, plugin: entry.config.pluginId },
      "Unloading plugin"
    );

    try {
      this.logger.debug(`Calling plugin.unload() instanceId=${instanceId}`);
      await entry.instance.unload?.();
      this.logger.debug(`Plugin.unload() completed instanceId=${instanceId}`);
    } finally {
      this.logger.debug(`Unregistering plugin components instanceId=${instanceId}`);
      await entry.registrar.unregisterAll();
      this.loaded.delete(instanceId);
      this.logger.debug(`Plugin removed from loaded map instanceId=${instanceId} remainingCount=${this.loaded.size}`);
      this.logger.info({ instance: instanceId }, "Plugin unloaded");
    }
  }

  async unloadAll(): Promise<void> {
    const ids = Array.from(this.loaded.keys());
    this.logger.debug(`unloadAll() starting count=${ids.length} ids=${ids.join(",")}`);
    for (const id of ids) {
      await this.unload(id);
    }
    this.logger.debug("unloadAll() complete");
  }

  private async ensurePluginDir(instanceId: string): Promise<string> {
    const dir = path.join(this.config.current.dataDir, "plugins", instanceId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  private resolveEnabledPlugins(settings: SettingsConfig): PluginInstanceSettings[] {
    const enabled = listEnabledPlugins(settings);
    const resolution = resolveExclusivePlugins(enabled, this.pluginCatalog);
    if (resolution.skipped.length > 0) {
      const exclusive = resolution.exclusive;
      const skippedIds = resolution.skipped.map((plugin) => plugin.instanceId).join(",");
      this.logger.warn(
        {
          exclusive: exclusive?.instanceId,
          skipped: skippedIds
        },
        "Exclusive plugin enabled; skipping other plugins"
      );
    }
    return resolution.allowed;
  }
}

function buildPluginEvent(source: { pluginId: string; instanceId: string }, event: PluginEventInput): PluginEvent {
  return {
    id: createId(),
    pluginId: source.pluginId,
    instanceId: source.instanceId,
    type: event.type,
    payload: event.payload,
    createdAt: new Date().toISOString()
  };
}
