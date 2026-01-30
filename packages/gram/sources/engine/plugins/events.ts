import { createId } from "@paralleldrive/cuid2";

export type PluginEventInput = {
  type: string;
  payload?: unknown;
};

export type PluginEvent = PluginEventInput & {
  id: string;
  pluginId: string;
  instanceId: string;
  createdAt: string;
};

export type PluginEventSource = {
  pluginId: string;
  instanceId: string;
};

export type PluginEventListener = (event: PluginEvent) => void;

export class PluginEventQueue {
  private queue: PluginEvent[] = [];
  private listeners = new Set<PluginEventListener>();

  emit(source: PluginEventSource, event: PluginEventInput): PluginEvent {
    const entry: PluginEvent = {
      id: createId(),
      pluginId: source.pluginId,
      instanceId: source.instanceId,
      type: event.type,
      payload: event.payload,
      createdAt: new Date().toISOString()
    };
    this.enqueue(entry);
    return entry;
  }

  enqueue(event: PluginEvent): void {
    this.queue.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  drain(): PluginEvent[] {
    if (this.queue.length === 0) {
      return [];
    }
    const drained = [...this.queue];
    this.queue = [];
    return drained;
  }

  size(): number {
    return this.queue.length;
  }

  onEvent(listener: PluginEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
