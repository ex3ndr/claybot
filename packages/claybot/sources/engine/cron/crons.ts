import path from "node:path";

import { getLogger } from "../../log.js";
import type { EngineEventBus } from "../ipc/events.js";
import type { Config, MessageContext } from "@/types";
import { CronScheduler } from "./cronScheduler.js";
import { CronStore } from "./cronStore.js";
import type { CronTaskContext, CronTaskDefinition, CronTaskWithPaths } from "./cronTypes.js";

const logger = getLogger("cron.facade");

export type CronsOptions = {
  config: Config;
  eventBus: EngineEventBus;
  onTask: (task: CronTaskContext, context: MessageContext) => void | Promise<void>;
};

/**
 * Coordinates cron storage + scheduling for engine runtime.
 * Expects: onTask handles routing to the agent system.
 */
export class Crons {
  private readonly eventBus: EngineEventBus;
  private readonly scheduler: CronScheduler;
  private readonly store: CronStore;

  constructor(options: CronsOptions) {
    this.eventBus = options.eventBus;
    const basePath = path.join(options.config.configDir, "cron");
    this.store = new CronStore(basePath);
    this.scheduler = new CronScheduler({
      store: this.store,
      onTask: options.onTask,
      onError: (error, taskId) => {
        logger.warn({ taskId, error }, "Cron task failed");
      },
      onTaskComplete: (task, runAt) => {
        this.eventBus.emit("cron.task.ran", { taskId: task.id, runAt: runAt.toISOString() });
      }
    });
  }

  async ensureDir(): Promise<void> {
    await this.store.ensureDir();
  }

  async start(): Promise<void> {
    await this.scheduler.start();
    this.eventBus.emit("cron.started", { tasks: this.scheduler.listTasks() });
  }

  stop(): void {
    this.scheduler.stop();
  }

  listScheduledTasks(): CronTaskWithPaths[] {
    return this.scheduler.listTasks();
  }

  async listTasks(): Promise<CronTaskWithPaths[]> {
    return this.store.listTasks();
  }

  async addTask(
    definition: Omit<CronTaskDefinition, "id"> & { id?: string }
  ): Promise<CronTaskWithPaths> {
    const task = await this.scheduler.addTask(definition);
    this.eventBus.emit("cron.task.added", { task });
    return task;
  }

  async deleteTask(taskId: string): Promise<boolean> {
    return this.scheduler.deleteTask(taskId);
  }

  async loadTask(taskId: string): Promise<CronTaskWithPaths | null> {
    return this.store.loadTask(taskId);
  }

  async readMemory(taskId: string): Promise<string> {
    return this.store.readMemory(taskId);
  }

  async writeMemory(taskId: string, content: string): Promise<void> {
    await this.store.writeMemory(taskId, content);
  }
}
