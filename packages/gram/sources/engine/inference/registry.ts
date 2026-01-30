import type { InferenceProvider } from "./types.js";

type RegisteredProvider = InferenceProvider & { pluginId: string };

export class InferenceRegistry {
  private providers = new Map<string, RegisteredProvider>();

  register(pluginId: string, provider: InferenceProvider): void {
    this.providers.set(provider.id, { ...provider, pluginId });
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  unregisterByPlugin(pluginId: string): void {
    for (const [id, entry] of this.providers.entries()) {
      if (entry.pluginId === pluginId) {
        this.providers.delete(id);
      }
    }
  }

  get(id: string): InferenceProvider | null {
    return this.providers.get(id) ?? null;
  }

  list(): InferenceProvider[] {
    return Array.from(this.providers.values());
  }
}
