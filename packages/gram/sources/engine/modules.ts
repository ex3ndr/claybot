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
    if (this.connectors.has(id)) {
      return { ok: true, status: "already-loaded" };
    }

    const unsubscribe = this.attach(id, connector);
    this.connectors.set(id, {
      connector,
      unsubscribe,
      loadedAt: new Date()
    });
    this.logger.info({ connector: id }, "Connector registered");
    return { ok: true, status: "loaded" };
  }

  async unregister(id: string, reason = "unload"): Promise<ConnectorActionResult> {
    const entry = this.connectors.get(id);
    if (!entry) {
      return { ok: true, status: "not-loaded" };
    }

    entry.unsubscribe?.();
    try {
      await entry.connector.shutdown?.(reason);
    } catch (error) {
      this.logger.warn({ connector: id, error }, "Connector shutdown failed");
    }
    this.connectors.delete(id);
    this.logger.info({ connector: id }, "Connector unregistered");
    return { ok: true, status: "unloaded" };
  }

  async unregisterAll(reason = "shutdown"): Promise<void> {
    const ids = Array.from(this.connectors.keys());
    for (const id of ids) {
      await this.unregister(id, reason);
    }
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

export class ImageGenerationRegistry {
  private providers = new Map<string, RegisteredImageProvider>();

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

export class ToolResolver {
  private tools = new Map<string, RegisteredTool>();

  register(pluginId: string, definition: ToolDefinition): void {
    this.tools.set(definition.tool.name, { ...definition, pluginId });
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  unregisterByPlugin(pluginId: string): void {
    for (const [name, entry] of this.tools.entries()) {
      if (entry.pluginId === pluginId) {
        this.tools.delete(name);
      }
    }
  }

  listTools(): Tool[] {
    return Array.from(this.tools.values()).map((entry) => entry.tool);
  }

  async execute(
    toolCall: ToolCall,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const entry = this.tools.get(toolCall.name);
    if (!entry) {
      return {
        toolMessage: buildToolError(toolCall, `Unknown tool: ${toolCall.name}`)
      };
    }

    try {
      const args = validateToolCall([entry.tool], toolCall);
      const result = await entry.execute(args, context, toolCall);
      if (!result.toolMessage.toolCallId) {
        result.toolMessage.toolCallId = toolCall.id;
      }
      if (!result.toolMessage.toolName) {
        result.toolMessage.toolName = toolCall.name;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed.";
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
