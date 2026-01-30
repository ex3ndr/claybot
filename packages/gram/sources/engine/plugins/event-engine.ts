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
  }

  register(type: string, handler: PluginEventHandler): () => void {
    const set = this.handlers.get(type) ?? new Set<PluginEventHandler>();
    set.add(handler);
    this.handlers.set(type, set);
    return () => {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(type);
      }
    };
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    const pending = this.queue.drain();
    for (const event of pending) {
      this.enqueue(event);
    }
    this.unsubscribe = this.queue.onEvent((event) => this.enqueue(event));
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private enqueue(event: PluginEvent): void {
    this.chain = this.chain
      .then(() => this.dispatch(event))
      .catch((error) => {
        this.logger.warn({ error, event }, "Plugin event handler failed");
      });
  }

  private async dispatch(event: PluginEvent): Promise<void> {
    const handlers = this.handlers.get(event.type);
    if (!handlers || handlers.size === 0) {
      this.logger.debug({ event }, "Unhandled plugin event");
      return;
    }

    for (const handler of handlers) {
      await handler(event);
    }
  }
}
