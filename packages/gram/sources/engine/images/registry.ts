import type { ImageGenerationProvider } from "./types.js";

type RegisteredProvider = ImageGenerationProvider & { pluginId: string };

export class ImageGenerationRegistry {
  private providers = new Map<string, RegisteredProvider>();

  register(pluginId: string, provider: ImageGenerationProvider): void {
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

  get(id: string): ImageGenerationProvider | null {
    return this.providers.get(id) ?? null;
  }

  list(): ImageGenerationProvider[] {
    return Array.from(this.providers.values());
  }
}
