import { getLogger } from "../../log.js";
import type {
  Connector,
  ConnectorMessage,
  MessageContext,
  MessageHandler,
  CommandHandler,
  CommandUnsubscribe,
  MessageUnsubscribe,
  PermissionDecision,
  PermissionHandler
} from "./connectors/types.js";
import type { AgentDescriptor } from "@/types";

export type ConnectorActionResult =
  | { ok: true; status: "loaded" | "already-loaded" | "unloaded" | "not-loaded" }
  | { ok: false; status: "error"; message: string };

export type ConnectorRegistryOptions = {
  onMessage: (
    source: string,
    message: ConnectorMessage,
    context: MessageContext,
    descriptor: AgentDescriptor
  ) => void | Promise<void>;
  onCommand?: (
    source: string,
    command: string,
    context: MessageContext,
    descriptor: AgentDescriptor
  ) => void | Promise<void>;
  onPermission?: (
    source: string,
    decision: PermissionDecision,
    context: MessageContext,
    descriptor: AgentDescriptor
  ) => void | Promise<void>;
  onFatal?: (source: string, reason: string, error?: unknown) => void;
};

type ManagedConnector = {
  connector: Connector;
  unsubscribe?: MessageUnsubscribe;
  commandUnsubscribe?: CommandUnsubscribe;
  permissionUnsubscribe?: MessageUnsubscribe;
  loadedAt: Date;
};

export class ConnectorRegistry {
  private connectors = new Map<string, ManagedConnector>();
  private onMessage: ConnectorRegistryOptions["onMessage"];
  private onCommand?: ConnectorRegistryOptions["onCommand"];
  private onPermission?: ConnectorRegistryOptions["onPermission"];
  private onFatal?: ConnectorRegistryOptions["onFatal"];
  private logger = getLogger("connectors.registry");

  constructor(options: ConnectorRegistryOptions) {
    this.onMessage = options.onMessage;
    this.onCommand = options.onCommand;
    this.onPermission = options.onPermission;
    this.onFatal = options.onFatal;
    this.logger.debug("ConnectorRegistry initialized");
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
    this.logger.debug(`register() called connectorId=${id}`);
    if (this.connectors.has(id)) {
      this.logger.debug(`Connector already registered connectorId=${id}`);
      return { ok: true, status: "already-loaded" };
    }

    this.logger.debug(`Attaching message handler connectorId=${id}`);
    const unsubscribe = this.attach(id, connector);
    const commandUnsubscribe = this.attachCommand(id, connector);
    const permissionUnsubscribe = this.attachPermission(id, connector);
    this.connectors.set(id, {
      connector,
      unsubscribe,
      commandUnsubscribe,
      permissionUnsubscribe,
      loadedAt: new Date()
    });
    this.logger.debug(`Connector added to registry connectorId=${id} totalConnectors=${this.connectors.size}`);
    this.logger.info({ connector: id }, "Connector registered");
    return { ok: true, status: "loaded" };
  }

  async unregister(id: string, reason = "unload"): Promise<ConnectorActionResult> {
    this.logger.debug(`unregister() called connectorId=${id} reason=${reason}`);
    const entry = this.connectors.get(id);
    if (!entry) {
      this.logger.debug(`Connector not found connectorId=${id}`);
      return { ok: true, status: "not-loaded" };
    }

    this.logger.debug(`Unsubscribing message handler connectorId=${id}`);
    entry.unsubscribe?.();
    entry.commandUnsubscribe?.();
    entry.permissionUnsubscribe?.();
    try {
      this.logger.debug(`Calling connector.shutdown() connectorId=${id} reason=${reason}`);
      await entry.connector.shutdown?.(reason);
      this.logger.debug(`Connector shutdown complete connectorId=${id}`);
    } catch (error) {
      this.logger.warn({ connector: id, error }, "Connector shutdown failed");
    }
    this.connectors.delete(id);
    this.logger.debug(`Connector removed from registry connectorId=${id} remainingConnectors=${this.connectors.size}`);
    this.logger.info({ connector: id }, "Connector unregistered");
    return { ok: true, status: "unloaded" };
  }

  async unregisterAll(reason = "shutdown"): Promise<void> {
    const ids = Array.from(this.connectors.keys());
    this.logger.debug(`unregisterAll() starting count=${ids.length} ids=${ids.join(",")} reason=${reason}`);
    for (const id of ids) {
      await this.unregister(id, reason);
    }
    this.logger.debug("unregisterAll() complete");
  }

  reportFatal(id: string, reason: string, error?: unknown): void {
    this.onFatal?.(id, reason, error);
  }

  private attach(id: string, connector: Connector): MessageUnsubscribe {
    const handler: MessageHandler = (message, context, descriptor) => {
      return this.onMessage(id, message, context, descriptor);
    };
    return connector.onMessage(handler);
  }

  private attachCommand(id: string, connector: Connector): CommandUnsubscribe | undefined {
    if (!this.onCommand || !connector.onCommand) {
      return undefined;
    }
    const handler: CommandHandler = (command, context, descriptor) => {
      return this.onCommand?.(id, command, context, descriptor);
    };
    return connector.onCommand(handler);
  }

  private attachPermission(id: string, connector: Connector): MessageUnsubscribe | undefined {
    if (!this.onPermission || !connector.onPermission) {
      return undefined;
    }
    const handler: PermissionHandler = (decision, context, descriptor) => {
      return this.onPermission?.(id, decision, context, descriptor);
    };
    return connector.onPermission(handler);
  }
}
