import { getLogger } from "../../log.js";
import type { ImageGenerationProvider } from "../images/types.js";

type RegisteredImageProvider = ImageGenerationProvider & { pluginId: string };

export class ImageGenerationRegistry {
  private providers = new Map<string, RegisteredImageProvider>();
  private logger = getLogger("image.registry");

  register(pluginId: string, provider: ImageGenerationProvider): void {
    this.logger.debug(`Registering image provider pluginId=${pluginId} providerId=${provider.id} label=${provider.label}`);
    this.providers.set(provider.id, { ...provider, pluginId });
    this.logger.debug(`Image provider registered totalProviders=${this.providers.size}`);
  }

  unregister(id: string): void {
    this.logger.debug(`Unregistering image provider providerId=${id}`);
    this.providers.delete(id);
  }

  unregisterByPlugin(pluginId: string): void {
    this.logger.debug(`Unregistering image providers by plugin pluginId=${pluginId}`);
    let count = 0;
    for (const [id, entry] of this.providers.entries()) {
      if (entry.pluginId === pluginId) {
        this.providers.delete(id);
        count++;
      }
    }
    this.logger.debug(`Image providers unregistered by plugin pluginId=${pluginId} unregisteredCount=${count}`);
  }

  get(id: string): ImageGenerationProvider | null {
    return this.providers.get(id) ?? null;
  }

  list(): ImageGenerationProvider[] {
    return Array.from(this.providers.values());
  }
}
