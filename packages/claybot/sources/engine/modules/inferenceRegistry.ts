import { getLogger } from "../../log.js";
import type { InferenceProvider } from "../inference/types.js";

type RegisteredInferenceProvider = InferenceProvider & { pluginId: string };

export class InferenceRegistry {
  private providers = new Map<string, RegisteredInferenceProvider>();
  private logger = getLogger("inference.registry");

  register(pluginId: string, provider: InferenceProvider): void {
    this.logger.debug(`Registering inference provider pluginId=${pluginId} providerId=${provider.id} label=${provider.label}`);
    this.providers.set(provider.id, { ...provider, pluginId });
    this.logger.debug(`Inference provider registered totalProviders=${this.providers.size}`);
  }

  unregister(id: string): void {
    this.logger.debug(`Unregistering inference provider providerId=${id}`);
    this.providers.delete(id);
  }

  unregisterByPlugin(pluginId: string): void {
    this.logger.debug(`Unregistering inference providers by plugin pluginId=${pluginId}`);
    let count = 0;
    for (const [id, entry] of this.providers.entries()) {
      if (entry.pluginId === pluginId) {
        this.providers.delete(id);
        count++;
      }
    }
    this.logger.debug(`Inference providers unregistered by plugin pluginId=${pluginId} unregisteredCount=${count}`);
  }

  get(id: string): InferenceProvider | null {
    const provider = this.providers.get(id) ?? null;
    this.logger.debug(`get() inference provider providerId=${id} found=${!!provider}`);
    return provider;
  }

  list(): InferenceProvider[] {
    return Array.from(this.providers.values());
  }
}
