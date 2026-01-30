import path from "node:path";
import { promises as fs } from "node:fs";

import { getLogger } from "../../log.js";
import type { FileStore } from "../../files/store.js";
import type { AuthStore } from "../../auth/store.js";
import type { PluginInstanceSettings, SettingsConfig } from "../../settings.js";
import { listEnabledPlugins } from "../../settings.js";
import type { PluginEventQueue } from "./events.js";
import { PluginModuleLoader } from "./loader.js";
import type { PluginDefinition } from "./catalog.js";
import type { PluginApi, PluginInstance, PluginModule } from "./types.js";
import type { PluginRegistry } from "./registry.js";
import type { EngineEventBus } from "../ipc/events.js";

export type PluginManagerOptions = {
  settings: SettingsConfig;
  registry: PluginRegistry;
  auth: AuthStore;
  fileStore: FileStore;
  pluginCatalog: Map<string, PluginDefinition>;
  dataDir: string;
  eventQueue: PluginEventQueue;
  mode?: "runtime" | "validate";
  engineEvents?: EngineEventBus;
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
  private settings: SettingsConfig;
  private registry: PluginRegistry;
  private auth: AuthStore;
  private fileStore: FileStore;
  private pluginCatalog: Map<string, PluginDefinition>;
  private dataDir: string;
  private eventQueue: PluginEventQueue;
  private mode: "runtime" | "validate";
  private engineEvents?: EngineEventBus;
  private loaded = new Map<string, LoadedPlugin>();
  private logger = getLogger("plugins.manager");

  constructor(options: PluginManagerOptions) {
    this.settings = options.settings;
    this.registry = options.registry;
    this.auth = options.auth;
    this.fileStore = options.fileStore;
    this.pluginCatalog = options.pluginCatalog;
    this.dataDir = options.dataDir;
    this.eventQueue = options.eventQueue;
    this.mode = options.mode ?? "runtime";
    this.engineEvents = options.engineEvents;
    this.logger.debug(
      { catalogSize: options.pluginCatalog.size, dataDir: options.dataDir, mode: this.mode },
      "[VERBOSE] PluginManager initialized"
    );
  }

  listLoaded(): string[] {
    return Array.from(this.loaded.keys());
  }

  listAvailable(): string[] {
    return Array.from(this.pluginCatalog.keys());
  }

  updateSettings(settings: SettingsConfig): void {
    this.settings = settings;
  }

  async syncWithSettings(settings: SettingsConfig): Promise<void> {
    this.logger.debug(
      { loadedCount: this.loaded.size },
      "[VERBOSE] syncWithSettings starting"
    );
    this.settings = settings;
    const desired = listEnabledPlugins(settings);
    const desiredMap = new Map(desired.map((plugin) => [plugin.instanceId, plugin]));
    this.logger.debug(
      { desiredCount: desired.length, desiredIds: desired.map(p => p.instanceId) },
      "[VERBOSE] Desired plugins from settings"
    );

    for (const [instanceId, entry] of this.loaded) {
      const next = desiredMap.get(instanceId);
      if (!next) {
        this.logger.debug({ instanceId }, "[VERBOSE] Plugin no longer desired, unloading");
        this.logger.info({ instance: instanceId }, "Unloading plugin (disabled)");
        await this.unload(instanceId);
        continue;
      }
      if (
        next.pluginId !== entry.config.pluginId ||
        !settingsEqual(next.settings, entry.config.settings)
      ) {
        this.logger.debug(
          { instanceId, oldPluginId: entry.config.pluginId, newPluginId: next.pluginId },
          "[VERBOSE] Plugin settings changed, reloading"
        );
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
          this.logger.debug({ instanceId: plugin.instanceId }, "[VERBOSE] Plugin already loaded, updating config");
          entry.config = plugin;
          entry.settings = plugin.settings ?? {};
        }
        continue;
      }
      this.logger.debug({ pluginId: plugin.pluginId, instanceId: plugin.instanceId }, "[VERBOSE] Loading new plugin");
      this.logger.info(
        { plugin: plugin.pluginId, instance: plugin.instanceId },
        "Loading plugin (settings sync)"
      );
      await this.load(plugin);
    }
    this.logger.debug({ loadedCount: this.loaded.size }, "[VERBOSE] syncWithSettings complete");
  }

  getConfig(instanceId: string): PluginInstanceSettings | null {
    return this.loaded.get(instanceId)?.config ?? null;
  }

  async load(pluginConfig: PluginInstanceSettings): Promise<void> {
    const instanceId = pluginConfig.instanceId;
    this.logger.debug(
      { pluginId: pluginConfig.pluginId, instanceId },
      "[VERBOSE] load() called"
    );

    if (this.loaded.has(instanceId)) {
      this.logger.debug({ instanceId }, "[VERBOSE] Plugin already loaded, skipping");
      return;
    }

    const definition = this.pluginCatalog.get(pluginConfig.pluginId);
    if (!definition) {
      this.logger.debug(
        { pluginId: pluginConfig.pluginId, catalogKeys: Array.from(this.pluginCatalog.keys()) },
        "[VERBOSE] Plugin not found in catalog"
      );
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

    this.logger.debug({ entryPath: definition.entryPath }, "[VERBOSE] Loading plugin module");
    const loader = new PluginModuleLoader(`plugin:${instanceId}`);
    const { module } = await loader.load(definition.entryPath);
    this.logger.debug("[VERBOSE] Plugin module loaded, parsing settings");
    const parsedSettings = module.settingsSchema.parse(pluginConfig.settings ?? {});
    this.logger.debug("[VERBOSE] Settings parsed successfully");

    this.logger.debug("[VERBOSE] Creating registrar");
    const registrar = this.registry.createRegistrar(instanceId);
    this.logger.debug("[VERBOSE] Ensuring plugin data directory");
    const dataDir = await this.ensurePluginDir(instanceId);
    this.logger.debug({ dataDir }, "[VERBOSE] Plugin data directory ready");

    this.logger.debug("[VERBOSE] Building plugin API");
    const api: PluginApi = {
      instance: pluginConfig,
      settings: parsedSettings,
      engineSettings: this.settings,
      logger: getLogger(`plugin.${instanceId}`),
      auth: this.auth,
      dataDir,
      registrar,
      fileStore: this.fileStore,
      mode: this.mode,
      engineEvents: this.engineEvents,
      events: {
        emit: (event) => {
          this.logger.debug({ instanceId, eventType: event.type }, "[VERBOSE] Plugin emitting event");
          this.eventQueue.emit(
            { pluginId: pluginConfig.pluginId, instanceId },
            event
          );
        }
      }
    };

    this.logger.debug("[VERBOSE] Creating plugin instance");
    const instance = await module.create(api);
    this.logger.debug("[VERBOSE] Plugin instance created");

    try {
      this.logger.debug("[VERBOSE] Calling plugin.load()");
      await instance.load?.();
      this.loaded.set(instanceId, {
        module,
        instance,
        config: pluginConfig,
        registrar,
        dataDir,
        settings: parsedSettings
      });
      this.logger.debug({ instanceId, loadedCount: this.loaded.size }, "[VERBOSE] Plugin registered in loaded map");
      this.logger.info(
        { plugin: pluginConfig.pluginId, instance: instanceId },
        "Plugin loaded"
      );
    } catch (error) {
      this.logger.debug({ instanceId, error: String(error) }, "[VERBOSE] Plugin load failed, cleaning up");
      await registrar.unregisterAll();
      throw error;
    }
  }

  async unload(instanceId: string): Promise<void> {
    this.logger.debug({ instanceId }, "[VERBOSE] unload() called");
    const entry = this.loaded.get(instanceId);
    if (!entry) {
      this.logger.debug({ instanceId }, "[VERBOSE] Plugin not loaded, nothing to unload");
      return;
    }

    this.logger.info(
      { instance: instanceId, plugin: entry.config.pluginId },
      "Unloading plugin"
    );

    try {
      this.logger.debug({ instanceId }, "[VERBOSE] Calling plugin.unload()");
      await entry.instance.unload?.();
      this.logger.debug({ instanceId }, "[VERBOSE] Plugin.unload() completed");
    } finally {
      this.logger.debug({ instanceId }, "[VERBOSE] Unregistering plugin components");
      await entry.registrar.unregisterAll();
      this.loaded.delete(instanceId);
      this.logger.debug({ instanceId, remainingCount: this.loaded.size }, "[VERBOSE] Plugin removed from loaded map");
      this.logger.info({ instance: instanceId }, "Plugin unloaded");
    }
  }

  async loadEnabled(settings: SettingsConfig): Promise<void> {
    this.settings = settings;
    const enabled = listEnabledPlugins(settings);
    this.logger.debug(
      { enabledCount: enabled.length, enabledIds: enabled.map(p => p.instanceId) },
      "[VERBOSE] loadEnabled() starting"
    );
    for (const plugin of enabled) {
      await this.load(plugin);
    }
    this.logger.debug({ loadedCount: this.loaded.size }, "[VERBOSE] loadEnabled() complete");
  }

  async unloadAll(): Promise<void> {
    const ids = Array.from(this.loaded.keys());
    this.logger.debug({ count: ids.length, ids }, "[VERBOSE] unloadAll() starting");
    for (const id of ids) {
      await this.unload(id);
    }
    this.logger.debug("[VERBOSE] unloadAll() complete");
  }

  private async ensurePluginDir(instanceId: string): Promise<string> {
    const dir = path.join(this.dataDir, "plugins", instanceId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }
}

function settingsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}
