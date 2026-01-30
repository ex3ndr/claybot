import { getLogger } from "../../log.js";
import type {
  Connector,
  ConnectorMessage,
  MessageContext,
  MessageHandler,
  MessageUnsubscribe
} from "./types.js";

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

  private attach(id: string, connector: Connector): MessageUnsubscribe {
    const handler: MessageHandler = (message, context) => {
      return this.onMessage(id, message, context);
    };
    return connector.onMessage(handler);
  }

  reportFatal(id: string, reason: string, error?: unknown): void {
    this.onFatal?.(id, reason, error);
  }
}
