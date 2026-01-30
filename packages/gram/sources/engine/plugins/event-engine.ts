import { getLogger } from "../../log.js";
import type { PluginEvent } from "./events.js";
import { PluginEventQueue } from "./events.js";

export type PluginEventHandler = (event: PluginEvent) => void | Promise<void>;

export class PluginEventEngine {
  private queue: PluginEventQueue;
  private handlers = new Map<string, Set<PluginEventHandler>>();
  private logger = getLogger("plugins.events");
  private unsubscribe: (() => void) | null = null;
  private chain: Promise<void> = Promise.resolve();
  private started = false;

  constructor(queue: PluginEventQueue) {
    this.queue = queue;
    this.logger.debug("[VERBOSE] PluginEventEngine initialized");
  }

  register(type: string, handler: PluginEventHandler): () => void {
    this.logger.debug({ eventType: type }, "[VERBOSE] Registering event handler");
    const set = this.handlers.get(type) ?? new Set<PluginEventHandler>();
    set.add(handler);
    this.handlers.set(type, set);
    this.logger.debug({ eventType: type, handlerCount: set.size }, "[VERBOSE] Event handler registered");
    return () => {
      this.logger.debug({ eventType: type }, "[VERBOSE] Unregistering event handler");
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(type);
      }
    };
  }

  start(): void {
    this.logger.debug({ alreadyStarted: this.started }, "[VERBOSE] start() called");
    if (this.started) {
      return;
    }
    this.started = true;
    const pending = this.queue.drain();
    this.logger.debug({ pendingCount: pending.length }, "[VERBOSE] Processing pending events");
    for (const event of pending) {
      this.enqueue(event);
    }
    this.unsubscribe = this.queue.onEvent((event) => this.enqueue(event));
    this.logger.debug("[VERBOSE] Event engine started and subscribed to queue");
  }

  stop(): void {
    this.logger.debug({ started: this.started }, "[VERBOSE] stop() called");
    if (!this.started) {
      return;
    }
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.logger.debug("[VERBOSE] Event engine stopped");
  }

  private enqueue(event: PluginEvent): void {
    this.logger.debug({ eventType: event.type, pluginId: event.pluginId }, "[VERBOSE] Enqueueing event for dispatch");
    this.chain = this.chain
      .then(() => this.dispatch(event))
      .catch((error) => {
        this.logger.warn({ error, event }, "Plugin event handler failed");
      });
  }

  private async dispatch(event: PluginEvent): Promise<void> {
    this.logger.debug({ eventType: event.type, pluginId: event.pluginId }, "[VERBOSE] Dispatching event");
    const handlers = this.handlers.get(event.type);
    if (!handlers || handlers.size === 0) {
      this.logger.debug({ eventType: event.type }, "[VERBOSE] No handlers for event type");
      return;
    }

    this.logger.debug({ eventType: event.type, handlerCount: handlers.size }, "[VERBOSE] Invoking handlers");
    let handlerIndex = 0;
    for (const handler of handlers) {
      this.logger.debug({ eventType: event.type, handlerIndex }, "[VERBOSE] Calling handler");
      await handler(event);
      handlerIndex++;
    }
    this.logger.debug({ eventType: event.type }, "[VERBOSE] All handlers invoked");
  }
}
