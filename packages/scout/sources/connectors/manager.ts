import { getLogger } from "../log.js";
import type {
  Connector,
  ConnectorMessage,
  MessageContext,
  MessageHandler,
  MessageUnsubscribe
} from "./types.js";
import {
  TelegramConnector,
  type TelegramConnectorOptions
} from "./telegram.js";

export type ConnectorId = "telegram";

export type ConnectorActionResult =
  | {
      ok: true;
      status: "loaded" | "already-loaded" | "unloaded" | "not-loaded";
    }
  | { ok: false; status: "unknown" | "missing-token"; message: string };

export type ConnectorManagerOptions = {
  onMessage: (
    source: string,
    message: ConnectorMessage,
    context: MessageContext
  ) => void | Promise<void>;
  onFatal?: (source: string, reason: string, error?: unknown) => void;
  telegramConfig?: Omit<TelegramConnectorOptions, "token"> | null;
};

type ManagedConnector = {
  connector: Connector;
  unsubscribe?: MessageUnsubscribe;
};

export class ConnectorManager {
  private connectors = new Map<ConnectorId, ManagedConnector>();
  private onMessage: ConnectorManagerOptions["onMessage"];
  private onFatal?: ConnectorManagerOptions["onFatal"];
  private telegramConfig: Omit<TelegramConnectorOptions, "token">;
  private telegramToken: string | null = null;
  private logger = getLogger("connectors.manager");

  constructor(options: ConnectorManagerOptions) {
    this.onMessage = options.onMessage;
    this.onFatal = options.onFatal;
    this.telegramConfig = options.telegramConfig ?? {};
  }

  list(): ConnectorId[] {
    return Array.from(this.connectors.keys());
  }

  has(id: ConnectorId): boolean {
    return this.connectors.has(id);
  }

  get(id: ConnectorId): Connector | null {
    return this.connectors.get(id)?.connector ?? null;
  }

  async loadTelegram(token: string): Promise<ConnectorActionResult> {
    if (this.connectors.has("telegram")) {
      if (this.telegramToken && this.telegramToken !== token) {
        await this.unload("telegram", "token-rotated");
      } else {
        return { ok: true, status: "already-loaded" };
      }
    }

    const connector = new TelegramConnector({
      ...this.telegramConfig,
      token,
      enableGracefulShutdown: false,
      onFatal: (reason, error) => {
        this.onFatal?.("telegram", reason, error);
      }
    });

    const unsubscribe = this.attach("telegram", connector);
    this.connectors.set("telegram", { connector, unsubscribe });
    this.telegramToken = token;
    this.logger.info("Connector loaded: telegram");
    return { ok: true, status: "loaded" };
  }

  async load(
    id: ConnectorId,
    token?: string | null
  ): Promise<ConnectorActionResult> {
    switch (id) {
      case "telegram": {
        if (!token) {
          return {
            ok: false,
            status: "missing-token",
            message: "Missing telegram token"
          };
        }
        return this.loadTelegram(token);
      }
      default:
        return { ok: false, status: "unknown", message: "Unknown connector" };
    }
  }

  async unload(id: ConnectorId, reason = "unload"): Promise<ConnectorActionResult> {
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
    if (id === "telegram") {
      this.telegramToken = null;
    }
    this.logger.info({ connector: id }, "Connector unloaded");
    return { ok: true, status: "unloaded" };
  }

  async unloadAll(reason = "shutdown"): Promise<void> {
    const ids = Array.from(this.connectors.keys());
    for (const id of ids) {
      await this.unload(id, reason);
    }
  }

  async syncTelegramToken(
    token: string | null
  ): Promise<ConnectorActionResult> {
    if (!token) {
      return this.unload("telegram", "token-removed");
    }
    return this.loadTelegram(token);
  }

  private attach(
    name: ConnectorId,
    connector: Connector
  ): MessageUnsubscribe {
    const handler: MessageHandler = (message, context) => {
      return this.onMessage(name, message, context);
    };
    return connector.onMessage(handler);
  }
}
