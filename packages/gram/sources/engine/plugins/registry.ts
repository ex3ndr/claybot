import type { Connector } from "../connectors/types.js";
import type { ConnectorRegistry } from "../connectors/registry.js";
import type { InferenceProvider } from "../inference/types.js";
import type { InferenceRegistry } from "../inference/registry.js";
import type { ImageGenerationProvider } from "../images/types.js";
import type { ImageGenerationRegistry } from "../images/registry.js";
import type { ToolDefinition } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";

type PluginRegistrations = {
  connectors: Set<string>;
  providers: Set<string>;
  tools: Set<string>;
  images: Set<string>;
};

export class PluginRegistrar {
  private pluginId: string;
  private connectorRegistry: ConnectorRegistry;
  private inferenceRegistry: InferenceRegistry;
  private imageRegistry: ImageGenerationRegistry;
  private toolRegistry: ToolRegistry;
  private registrations: PluginRegistrations;

  constructor(
    pluginId: string,
    connectorRegistry: ConnectorRegistry,
    inferenceRegistry: InferenceRegistry,
    imageRegistry: ImageGenerationRegistry,
    toolRegistry: ToolRegistry
  ) {
    this.pluginId = pluginId;
    this.connectorRegistry = connectorRegistry;
    this.inferenceRegistry = inferenceRegistry;
    this.imageRegistry = imageRegistry;
    this.toolRegistry = toolRegistry;
    this.registrations = {
      connectors: new Set(),
      providers: new Set(),
      tools: new Set(),
      images: new Set()
    };
  }

  registerConnector(id: string, connector: Connector): void {
    this.connectorRegistry.register(id, connector);
    this.registrations.connectors.add(id);
  }

  async unregisterConnector(id: string): Promise<void> {
    await this.connectorRegistry.unregister(id, "plugin-unload");
    this.registrations.connectors.delete(id);
  }

  registerInferenceProvider(provider: InferenceProvider): void {
    this.inferenceRegistry.register(this.pluginId, provider);
    this.registrations.providers.add(provider.id);
  }

  unregisterInferenceProvider(id: string): void {
    this.inferenceRegistry.unregister(id);
    this.registrations.providers.delete(id);
  }

  registerTool(definition: ToolDefinition): void {
    this.toolRegistry.register(this.pluginId, definition);
    this.registrations.tools.add(definition.tool.name);
  }

  unregisterTool(name: string): void {
    this.toolRegistry.unregister(name);
    this.registrations.tools.delete(name);
  }

  registerImageProvider(provider: ImageGenerationProvider): void {
    this.imageRegistry.register(this.pluginId, provider);
    this.registrations.images.add(provider.id);
  }

  unregisterImageProvider(id: string): void {
    this.imageRegistry.unregister(id);
    this.registrations.images.delete(id);
  }

  async unregisterAll(): Promise<void> {
    for (const id of this.registrations.connectors) {
      await this.connectorRegistry.unregister(id, "plugin-unload");
    }
    for (const id of this.registrations.providers) {
      this.inferenceRegistry.unregister(id);
    }
    for (const id of this.registrations.images) {
      this.imageRegistry.unregister(id);
    }
    for (const name of this.registrations.tools) {
      this.toolRegistry.unregister(name);
    }
    this.registrations.connectors.clear();
    this.registrations.providers.clear();
    this.registrations.images.clear();
    this.registrations.tools.clear();
  }
}

export class PluginRegistry {
  private connectorRegistry: ConnectorRegistry;
  private inferenceRegistry: InferenceRegistry;
  private imageRegistry: ImageGenerationRegistry;
  private toolRegistry: ToolRegistry;

  constructor(
    connectorRegistry: ConnectorRegistry,
    inferenceRegistry: InferenceRegistry,
    imageRegistry: ImageGenerationRegistry,
    toolRegistry: ToolRegistry
  ) {
    this.connectorRegistry = connectorRegistry;
    this.inferenceRegistry = inferenceRegistry;
    this.imageRegistry = imageRegistry;
    this.toolRegistry = toolRegistry;
  }

  createRegistrar(pluginId: string): PluginRegistrar {
    return new PluginRegistrar(
      pluginId,
      this.connectorRegistry,
      this.inferenceRegistry,
      this.imageRegistry,
      this.toolRegistry
    );
  }
}
