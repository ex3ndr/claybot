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
    const activeProviders = listProviders(settings).filter(
      (provider) => provider.enabled !== false
    );

    const activeIds = new Set(activeProviders.map((provider) => provider.id));
    for (const [id, entry] of this.loaded.entries()) {
      if (!activeIds.has(id)) {
        await entry.instance.unload?.();
        this.loaded.delete(id);
        logger.info({ provider: id }, "Provider unloaded");
      }
    }

    for (const providerSettings of activeProviders) {
      const definition = getProviderDefinition(providerSettings.id);
      if (!definition) {
        logger.warn({ provider: providerSettings.id }, "Unknown provider");
        continue;
      }

      const settingsHash = hashSettings(providerSettings);
      const existing = this.loaded.get(providerSettings.id);
      if (existing && existing.settingsHash === settingsHash) {
        continue;
      }

      if (existing) {
        await existing.instance.unload?.();
        this.loaded.delete(providerSettings.id);
      }

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
      await instance.load?.();
      this.loaded.set(providerSettings.id, { instance, settingsHash });
      logger.info({ provider: providerSettings.id }, "Provider loaded");
    }
  }

  static listDefinitions() {
    return listProviderDefinitions();
  }
}

function hashSettings(settings: ProviderSettings): string {
  return JSON.stringify(settings);
}
