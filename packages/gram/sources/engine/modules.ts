import type { ToolCall, ToolResultMessage, Tool } from "@mariozechner/pi-ai";
import { validateToolCall } from "@mariozechner/pi-ai";

import { getLogger } from "../log.js";
import type {
  Connector,
  ConnectorMessage,
  MessageContext,
  MessageHandler,
  MessageUnsubscribe
} from "./connectors/types.js";
import type { InferenceProvider } from "./inference/types.js";
import type { ImageGenerationProvider } from "./images/types.js";
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "./tools/types.js";

export type ConnectorActionResult =
  | { ok: true; status: "loaded" | "already-loaded" | "unloaded" | "not-loaded" }
  | { ok: false; status: "error"; message: string };

export type ConnectorRegistryOptions = {
  onMessage: (
    source: string,
    message: ConnectorMessage,
    context: MessageContext
  ) => void | Promise<void>;
  onFatal?: (source: string, reason: string, error?: unknown) => void;
};

type ManagedConnector = {
  connector: Connector;
  unsubscribe?: MessageUnsubscribe;
  loadedAt: Date;
};

type RegisteredInferenceProvider = InferenceProvider & { pluginId: string };

type RegisteredImageProvider = ImageGenerationProvider & { pluginId: string };

type RegisteredTool = ToolDefinition & { pluginId: string };

const logger = getLogger("engine.modules");

export class ConnectorRegistry {
  private connectors = new Map<string, ManagedConnector>();
  private onMessage: ConnectorRegistryOptions["onMessage"];
  private onFatal?: ConnectorRegistryOptions["onFatal"];
  private logger = getLogger("connectors.registry");

  constructor(options: ConnectorRegistryOptions) {
    this.onMessage = options.onMessage;
    this.onFatal = options.onFatal;
    this.logger.debug("[VERBOSE] ConnectorRegistry initialized");
  }

  list(): string[] {
    return Array.from(this.connectors.keys());
  }

  listStatus(): Array<{ id: string; loadedAt: Date }> {
    return Array.from(this.connectors.entries()).map(([id, entry]) => ({
      id,
      loadedAt: entry.loadedAt
    }));
  }

  has(id: string): boolean {
    return this.connectors.has(id);
  }

  get(id: string): Connector | null {
    return this.connectors.get(id)?.connector ?? null;
  }

  register(id: string, connector: Connector): ConnectorActionResult {
    this.logger.debug({ connectorId: id }, "[VERBOSE] register() called");
    if (this.connectors.has(id)) {
      this.logger.debug({ connectorId: id }, "[VERBOSE] Connector already registered");
      return { ok: true, status: "already-loaded" };
    }

    this.logger.debug({ connectorId: id }, "[VERBOSE] Attaching message handler");
    const unsubscribe = this.attach(id, connector);
    this.connectors.set(id, {
      connector,
      unsubscribe,
      loadedAt: new Date()
    });
    this.logger.debug({ connectorId: id, totalConnectors: this.connectors.size }, "[VERBOSE] Connector added to registry");
    this.logger.info({ connector: id }, "Connector registered");
    return { ok: true, status: "loaded" };
  }

  async unregister(id: string, reason = "unload"): Promise<ConnectorActionResult> {
    this.logger.debug({ connectorId: id, reason }, "[VERBOSE] unregister() called");
    const entry = this.connectors.get(id);
    if (!entry) {
      this.logger.debug({ connectorId: id }, "[VERBOSE] Connector not found");
      return { ok: true, status: "not-loaded" };
    }

    this.logger.debug({ connectorId: id }, "[VERBOSE] Unsubscribing message handler");
    entry.unsubscribe?.();
    try {
      this.logger.debug({ connectorId: id, reason }, "[VERBOSE] Calling connector.shutdown()");
      await entry.connector.shutdown?.(reason);
      this.logger.debug({ connectorId: id }, "[VERBOSE] Connector shutdown complete");
    } catch (error) {
      this.logger.warn({ connector: id, error }, "Connector shutdown failed");
    }
    this.connectors.delete(id);
    this.logger.debug({ connectorId: id, remainingConnectors: this.connectors.size }, "[VERBOSE] Connector removed from registry");
    this.logger.info({ connector: id }, "Connector unregistered");
    return { ok: true, status: "unloaded" };
  }

  async unregisterAll(reason = "shutdown"): Promise<void> {
    const ids = Array.from(this.connectors.keys());
    this.logger.debug({ count: ids.length, ids, reason }, "[VERBOSE] unregisterAll() starting");
    for (const id of ids) {
      await this.unregister(id, reason);
    }
    this.logger.debug("[VERBOSE] unregisterAll() complete");
  }

  reportFatal(id: string, reason: string, error?: unknown): void {
    this.onFatal?.(id, reason, error);
  }

  private attach(id: string, connector: Connector): MessageUnsubscribe {
    const handler: MessageHandler = (message, context) => {
      return this.onMessage(id, message, context);
    };
    return connector.onMessage(handler);
  }
}

export class InferenceRegistry {
  private providers = new Map<string, RegisteredInferenceProvider>();
  private logger = getLogger("inference.registry");

  register(pluginId: string, provider: InferenceProvider): void {
    this.logger.debug({ pluginId, providerId: provider.id, label: provider.label }, "[VERBOSE] Registering inference provider");
    this.providers.set(provider.id, { ...provider, pluginId });
    this.logger.debug({ totalProviders: this.providers.size }, "[VERBOSE] Inference provider registered");
  }

  unregister(id: string): void {
    this.logger.debug({ providerId: id }, "[VERBOSE] Unregistering inference provider");
    this.providers.delete(id);
  }

  unregisterByPlugin(pluginId: string): void {
    this.logger.debug({ pluginId }, "[VERBOSE] Unregistering inference providers by plugin");
    let count = 0;
    for (const [id, entry] of this.providers.entries()) {
      if (entry.pluginId === pluginId) {
        this.providers.delete(id);
        count++;
      }
    }
    this.logger.debug({ pluginId, unregisteredCount: count }, "[VERBOSE] Inference providers unregistered by plugin");
  }

  get(id: string): InferenceProvider | null {
    const provider = this.providers.get(id) ?? null;
    this.logger.debug({ providerId: id, found: !!provider }, "[VERBOSE] get() inference provider");
    return provider;
  }

  list(): InferenceProvider[] {
    return Array.from(this.providers.values());
  }
}

export class ImageGenerationRegistry {
  private providers = new Map<string, RegisteredImageProvider>();
  private logger = getLogger("image.registry");

  register(pluginId: string, provider: ImageGenerationProvider): void {
    this.logger.debug({ pluginId, providerId: provider.id, label: provider.label }, "[VERBOSE] Registering image provider");
    this.providers.set(provider.id, { ...provider, pluginId });
    this.logger.debug({ totalProviders: this.providers.size }, "[VERBOSE] Image provider registered");
  }

  unregister(id: string): void {
    this.logger.debug({ providerId: id }, "[VERBOSE] Unregistering image provider");
    this.providers.delete(id);
  }

  unregisterByPlugin(pluginId: string): void {
    this.logger.debug({ pluginId }, "[VERBOSE] Unregistering image providers by plugin");
    let count = 0;
    for (const [id, entry] of this.providers.entries()) {
      if (entry.pluginId === pluginId) {
        this.providers.delete(id);
        count++;
      }
    }
    this.logger.debug({ pluginId, unregisteredCount: count }, "[VERBOSE] Image providers unregistered by plugin");
  }

  get(id: string): ImageGenerationProvider | null {
    return this.providers.get(id) ?? null;
  }

  list(): ImageGenerationProvider[] {
    return Array.from(this.providers.values());
  }
}

export class ToolResolver {
  private tools = new Map<string, RegisteredTool>();

  register(pluginId: string, definition: ToolDefinition): void {
    logger.debug({ pluginId, toolName: definition.tool.name }, "[VERBOSE] Registering tool");
    this.tools.set(definition.tool.name, { ...definition, pluginId });
    logger.debug({ totalTools: this.tools.size }, "[VERBOSE] Tool registered");
  }

  unregister(name: string): void {
    logger.debug({ toolName: name }, "[VERBOSE] Unregistering tool");
    this.tools.delete(name);
  }

  unregisterByPlugin(pluginId: string): void {
    logger.debug({ pluginId }, "[VERBOSE] Unregistering tools by plugin");
    let count = 0;
    for (const [name, entry] of this.tools.entries()) {
      if (entry.pluginId === pluginId) {
        this.tools.delete(name);
        count++;
      }
    }
    logger.debug({ pluginId, unregisteredCount: count }, "[VERBOSE] Tools unregistered by plugin");
  }

  listTools(): Tool[] {
    return Array.from(this.tools.values()).map((entry) => entry.tool);
  }

  async execute(
    toolCall: ToolCall,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    logger.debug(
      { toolName: toolCall.name, toolCallId: toolCall.id, argsPreview: JSON.stringify(toolCall.arguments).slice(0, 100) },
      "[VERBOSE] execute() called"
    );
    const entry = this.tools.get(toolCall.name);
    if (!entry) {
      logger.debug({ toolName: toolCall.name, availableTools: Array.from(this.tools.keys()) }, "[VERBOSE] Tool not found");
      return {
        toolMessage: buildToolError(toolCall, `Unknown tool: ${toolCall.name}`)
      };
    }

    try {
      logger.debug({ toolName: toolCall.name }, "[VERBOSE] Validating tool call arguments");
      const args = validateToolCall([entry.tool], toolCall);
      logger.debug({ toolName: toolCall.name }, "[VERBOSE] Arguments validated, executing tool");
      const startTime = Date.now();
      const result = await entry.execute(args, context, toolCall);
      const duration = Date.now() - startTime;
      logger.debug(
        { toolName: toolCall.name, durationMs: duration, isError: result.toolMessage.isError, fileCount: result.files?.length ?? 0 },
        "[VERBOSE] Tool execution completed"
      );
      if (!result.toolMessage.toolCallId) {
        result.toolMessage.toolCallId = toolCall.id;
      }
      if (!result.toolMessage.toolName) {
        result.toolMessage.toolName = toolCall.name;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed.";
      logger.debug({ toolName: toolCall.name, error: String(error) }, "[VERBOSE] Tool execution threw error");
      logger.warn({ tool: toolCall.name, error }, "Tool execution failed");
      return { toolMessage: buildToolError(toolCall, message) };
    }
  }
}

function buildToolError(toolCall: ToolCall, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text }],
    isError: true,
    timestamp: Date.now()
  };
}
