import { listProviders, type ProviderSettings, type SettingsConfig } from "../settings.js";
import type { AuthStore } from "../auth/store.js";
import type { FileStore } from "../files/store.js";
import type { InferenceRegistry, ImageGenerationRegistry } from "../engine/modules.js";
import { getLogger } from "../log.js";
import { getProviderDefinition, listProviderDefinitions } from "./catalog.js";
import type { ProviderInstance } from "./types.js";

export type ProviderManagerOptions = {
  settings: SettingsConfig;
  auth: AuthStore;
  fileStore: FileStore;
  inferenceRegistry: InferenceRegistry;
  imageRegistry: ImageGenerationRegistry;
};

type LoadedProvider = {
  instance: ProviderInstance;
  settingsHash: string;
};

const logger = getLogger("providers.manager");

export class ProviderManager {
  private auth: AuthStore;
  private fileStore: FileStore;
  private inferenceRegistry: InferenceRegistry;
  private imageRegistry: ImageGenerationRegistry;
  private loaded = new Map<string, LoadedProvider>();

  constructor(options: ProviderManagerOptions) {
    this.auth = options.auth;
    this.fileStore = options.fileStore;
    this.inferenceRegistry = options.inferenceRegistry;
    this.imageRegistry = options.imageRegistry;
  }

  listLoaded(): string[] {
    return Array.from(this.loaded.keys());
  }

  async sync(settings: SettingsConfig): Promise<void> {
    logger.debug({ loadedCount: this.loaded.size }, "[VERBOSE] sync() starting");
    const activeProviders = listProviders(settings).filter(
      (provider) => provider.enabled !== false
    );
    logger.debug(
      { activeCount: activeProviders.length, activeIds: activeProviders.map(p => p.id) },
      "[VERBOSE] Active providers from settings"
    );

    const activeIds = new Set(activeProviders.map((provider) => provider.id));
    for (const [id, entry] of this.loaded.entries()) {
      if (!activeIds.has(id)) {
        logger.debug({ providerId: id }, "[VERBOSE] Provider no longer active, unloading");
        await entry.instance.unload?.();
        this.loaded.delete(id);
        logger.info({ provider: id }, "Provider unloaded");
      }
    }

    for (const providerSettings of activeProviders) {
      logger.debug({ providerId: providerSettings.id, model: providerSettings.model }, "[VERBOSE] Processing provider");
      const definition = getProviderDefinition(providerSettings.id);
      if (!definition) {
        logger.debug({ providerId: providerSettings.id }, "[VERBOSE] Provider definition not found");
        logger.warn({ provider: providerSettings.id }, "Unknown provider");
        continue;
      }

      const settingsHash = hashSettings(providerSettings);
      const existing = this.loaded.get(providerSettings.id);
      if (existing && existing.settingsHash === settingsHash) {
        logger.debug({ providerId: providerSettings.id }, "[VERBOSE] Provider already loaded with same settings");
        continue;
      }

      if (existing) {
        logger.debug({ providerId: providerSettings.id }, "[VERBOSE] Provider settings changed, reloading");
        await existing.instance.unload?.();
        this.loaded.delete(providerSettings.id);
      }

      logger.debug({ providerId: providerSettings.id }, "[VERBOSE] Creating provider instance");
      const instance = await Promise.resolve(
        definition.create({
          settings: providerSettings,
          auth: this.auth,
          fileStore: this.fileStore,
          inferenceRegistry: this.inferenceRegistry,
          imageRegistry: this.imageRegistry,
          logger
        })
      );
      logger.debug({ providerId: providerSettings.id }, "[VERBOSE] Calling provider.load()");
      await instance.load?.();
      this.loaded.set(providerSettings.id, { instance, settingsHash });
      logger.debug({ providerId: providerSettings.id, totalLoaded: this.loaded.size }, "[VERBOSE] Provider registered");
      logger.info({ provider: providerSettings.id }, "Provider loaded");
    }
    logger.debug({ loadedCount: this.loaded.size }, "[VERBOSE] sync() complete");
  }

  static listDefinitions() {
    return listProviderDefinitions();
  }
}

function hashSettings(settings: ProviderSettings): string {
  return JSON.stringify(settings);
}
