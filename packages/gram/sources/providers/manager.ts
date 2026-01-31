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

  listLoadedDetails(): Array<{ id: string; name: string }> {
    return Array.from(this.loaded.keys()).map((id) => {
      const definition = getProviderDefinition(id);
      return {
        id,
        name: definition?.name ?? id
      };
    });
  }

  async sync(settings: SettingsConfig): Promise<void> {
    logger.debug(`sync() starting loadedCount=${this.loaded.size}`);
    const activeProviders = listProviders(settings).filter(
      (provider) => provider.enabled !== false
    );
    const activeIds = activeProviders.map(p => p.id).join(",");
    logger.debug(`Active providers from settings activeCount=${activeProviders.length} activeIds=${activeIds}`);

    const activeIdSet = new Set(activeProviders.map((provider) => provider.id));
    for (const [id, entry] of this.loaded.entries()) {
      if (!activeIdSet.has(id)) {
        logger.debug(`Provider no longer active, unloading providerId=${id}`);
        await entry.instance.unload?.();
        this.loaded.delete(id);
        logger.info({ provider: id }, "Provider unloaded");
      }
    }

    for (const providerSettings of activeProviders) {
      logger.debug(`Processing provider providerId=${providerSettings.id} model=${providerSettings.model}`);
      const definition = getProviderDefinition(providerSettings.id);
      if (!definition) {
        logger.debug(`Provider definition not found providerId=${providerSettings.id}`);
        logger.warn({ provider: providerSettings.id }, "Unknown provider");
        continue;
      }

      const settingsHash = hashSettings(providerSettings);
      const existing = this.loaded.get(providerSettings.id);
      if (existing && existing.settingsHash === settingsHash) {
        logger.debug(`Provider already loaded with same settings providerId=${providerSettings.id}`);
        continue;
      }

      if (existing) {
        logger.debug(`Provider settings changed, reloading providerId=${providerSettings.id}`);
        await existing.instance.unload?.();
        this.loaded.delete(providerSettings.id);
      }

      logger.debug(`Creating provider instance providerId=${providerSettings.id}`);
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
      logger.debug(`Calling provider.load() providerId=${providerSettings.id}`);
      await instance.load?.();
      this.loaded.set(providerSettings.id, { instance, settingsHash });
      logger.debug(`Provider registered providerId=${providerSettings.id} totalLoaded=${this.loaded.size}`);
      logger.info({ provider: providerSettings.id }, "Provider loaded");
    }
    logger.debug(`sync() complete loadedCount=${this.loaded.size}`);
  }

  static listDefinitions() {
    return listProviderDefinitions();
  }
}

function hashSettings(settings: ProviderSettings): string {
  return JSON.stringify(settings);
}
