import path from "node:path";

import type {
  Connector,
  ImageGenerationProvider,
  InferenceProvider,
  ToolDefinition
} from "@/types";
import type { ConnectorRegistry } from "../modules/connectorRegistry.js";
import type { ImageGenerationRegistry } from "../modules/imageGenerationRegistry.js";
import type { InferenceRegistry } from "../modules/inferenceRegistry.js";
import type { ToolResolver } from "../modules/toolResolver.js";
import { ModuleRegistry } from "../modules/moduleRegistry.js";

type PluginRegistrations = {
  connectors: Set<string>;
  providers: Set<string>;
  tools: Set<string>;
  images: Set<string>;
  skills: Set<string>;
};

export class PluginRegistrar {
  private pluginId: string;
  private connectorRegistry: ConnectorRegistry;
  private inferenceRegistry: InferenceRegistry;
  private imageRegistry: ImageGenerationRegistry;
  private toolResolver: ToolResolver;
  private registrations: PluginRegistrations;

  constructor(
    pluginId: string,
    connectorRegistry: ConnectorRegistry,
    inferenceRegistry: InferenceRegistry,
    imageRegistry: ImageGenerationRegistry,
    toolResolver: ToolResolver
  ) {
    this.pluginId = pluginId;
    this.connectorRegistry = connectorRegistry;
    this.inferenceRegistry = inferenceRegistry;
    this.imageRegistry = imageRegistry;
    this.toolResolver = toolResolver;
    this.registrations = {
      connectors: new Set(),
      providers: new Set(),
      tools: new Set(),
      images: new Set(),
      skills: new Set()
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
    this.toolResolver.register(this.pluginId, definition);
    this.registrations.tools.add(definition.tool.name);
  }

  unregisterTool(name: string): void {
    this.toolResolver.unregister(name);
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

  registerSkill(skillPath: string): void {
    const resolved = path.resolve(skillPath);
    this.registrations.skills.add(resolved);
  }

  unregisterSkill(skillPath: string): void {
    const resolved = path.resolve(skillPath);
    this.registrations.skills.delete(resolved);
  }

  listSkills(): string[] {
    return Array.from(this.registrations.skills.values());
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
      this.toolResolver.unregister(name);
    }
    this.registrations.connectors.clear();
    this.registrations.providers.clear();
    this.registrations.images.clear();
    this.registrations.tools.clear();
    this.registrations.skills.clear();
  }
}

export class PluginRegistry {
  private connectorRegistry: ConnectorRegistry;
  private inferenceRegistry: InferenceRegistry;
  private imageRegistry: ImageGenerationRegistry;
  private toolResolver: ToolResolver;

  constructor(
    modules: ModuleRegistry,
  ) {
    this.connectorRegistry = modules.connectors;
    this.inferenceRegistry = modules.inference;
    this.imageRegistry = modules.images;
    this.toolResolver = modules.tools;
  }

  createRegistrar(pluginId: string): PluginRegistrar {
    return new PluginRegistrar(
      pluginId,
      this.connectorRegistry,
      this.inferenceRegistry,
      this.imageRegistry,
      this.toolResolver
    );
  }
}
