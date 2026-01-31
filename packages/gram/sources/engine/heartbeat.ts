import { getLogger } from "../log.js";
import type { HeartbeatDefinition } from "./heartbeat-store.js";
import { HeartbeatStore } from "./heartbeat-store.js";

const logger = getLogger("heartbeat.scheduler");

export type HeartbeatSchedulerOptions = {
  store: HeartbeatStore;
  intervalMs?: number;
  onTask: (task: HeartbeatDefinition) => void | Promise<void>;
  onError?: (error: unknown, taskId?: string) => void | Promise<void>;
};

export class HeartbeatScheduler {
  private store: HeartbeatStore;
  private intervalMs: number;
  private onTask: HeartbeatSchedulerOptions["onTask"];
  private onError?: HeartbeatSchedulerOptions["onError"];
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private stopped = false;
  private running = false;

  constructor(options: HeartbeatSchedulerOptions) {
    this.store = options.store;
    this.intervalMs = options.intervalMs ?? 30 * 60 * 1000;
    this.onTask = options.onTask;
    this.onError = options.onError;
    logger.debug("HeartbeatScheduler initialized");
  }

  async start(): Promise<void> {
    logger.debug(`start() called started=${this.started} stopped=${this.stopped}`);
    if (this.started || this.stopped) {
      return;
    }
    this.started = true;
    this.scheduleNext();
  }

  stop(): void {
    logger.debug(`stop() called stopped=${this.stopped}`);
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.debug("HeartbeatScheduler stopped");
  }

  async runNow(taskIds?: string[]): Promise<{ ran: number; taskIds: string[] }> {
    return this.runOnce(taskIds);
  }

  async listTasks(): Promise<HeartbeatDefinition[]> {
    return this.store.listTasks();
  }

  private scheduleNext(): void {
    if (this.stopped) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, this.intervalMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped) {
      return;
    }
    try {
      await this.runOnce();
    } finally {
      this.scheduleNext();
    }
  }

  private async runOnce(taskIds?: string[]): Promise<{ ran: number; taskIds: string[] }> {
    if (this.running) {
      logger.debug("HeartbeatScheduler run skipped (already running)");
      return { ran: 0, taskIds: [] };
    }
    this.running = true;
    try {
      const tasks = await this.store.listTasks();
      const filtered = taskIds && taskIds.length > 0
        ? tasks.filter((task) => taskIds.includes(task.id))
        : tasks;
      if (filtered.length === 0) {
        return { ran: 0, taskIds: [] };
      }
      for (const task of filtered) {
        try {
          logger.info({ taskId: task.id, title: task.title }, "Executing heartbeat task");
          await this.onTask(task);
        } catch (error) {
          logger.warn({ taskId: task.id, error }, "Heartbeat task failed");
          await this.onError?.(error, task.id);
        }
      }
      return { ran: filtered.length, taskIds: filtered.map((task) => task.id) };
    } catch (error) {
      logger.warn({ error }, "Heartbeat run failed");
      await this.onError?.(error, undefined);
      return { ran: 0, taskIds: [] };
    } finally {
      this.running = false;
    }
  }
}
