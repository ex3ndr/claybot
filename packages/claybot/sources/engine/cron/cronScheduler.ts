import type { MessageContext } from "@/types";
import { getLogger } from "../../log.js";
import { CronStore } from "./cronStore.js";
import type {
  CronTaskDefinition,
  CronTaskWithPaths,
  CronTaskContext,
  ScheduledTask
} from "./cronTypes.js";
import { cronTimeGetNext } from "./cronTimeGetNext.js";

const logger = getLogger("cron.scheduler");

export type CronSchedulerOptions = {
  store: CronStore;
  onTask: (
    context: CronTaskContext,
    messageContext: MessageContext
  ) => void | Promise<void>;
  onError?: (error: unknown, taskId: string) => void | Promise<void>;
  onTaskComplete?: (task: CronTaskWithPaths, runAt: Date) => void | Promise<void>;
};

/**
 * Schedules and executes cron tasks based on their cron expressions.
 */
export class CronScheduler {
  private store: CronStore;
  private tasks = new Map<string, ScheduledTask>();
  private started = false;
  private stopped = false;
  private onTask: CronSchedulerOptions["onTask"];
  private onError?: CronSchedulerOptions["onError"];
  private onTaskComplete?: CronSchedulerOptions["onTaskComplete"];
  private tickTimer: NodeJS.Timeout | null = null;
  private runningTasks = new Set<string>();

  constructor(options: CronSchedulerOptions) {
    this.store = options.store;
    this.onTask = options.onTask;
    this.onError = options.onError;
    this.onTaskComplete = options.onTaskComplete;
    logger.debug("CronScheduler initialized");
  }

  async start(): Promise<void> {
    logger.debug(`start() called started=${this.started} stopped=${this.stopped}`);
    if (this.started || this.stopped) {
      logger.debug("Already started or stopped, returning");
      return;
    }

    this.started = true;

    // Load tasks from disk
    const tasks = await this.store.listTasks();
    logger.debug(`Loaded tasks from disk taskCount=${tasks.length}`);

    for (const task of tasks) {
      if (task.enabled === false) {
        logger.debug(`Task disabled, skipping taskId=${task.id}`);
        continue;
      }

      this.scheduleTask(task);
    }

    this.scheduleNextTick();
    logger.debug("All tasks scheduled");
  }

  stop(): void {
    logger.debug(`stop() called stopped=${this.stopped}`);
    if (this.stopped) {
      logger.debug("Already stopped, returning");
      return;
    }

    this.stopped = true;
    logger.debug(`Clearing timers taskCount=${this.tasks.size}`);

    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.runningTasks.clear();
    this.tasks.clear();
    logger.debug("CronScheduler stopped");
  }

  async reload(): Promise<void> {
    logger.debug("Reloading tasks from disk");

    this.tasks.clear();

    if (!this.started || this.stopped) {
      return;
    }

    // Reload from disk
    const tasks = await this.store.listTasks();
    for (const task of tasks) {
      if (task.enabled === false) {
        continue;
      }
      this.scheduleTask(task);
    }

    this.scheduleNextTick();
    logger.debug(`Tasks reloaded taskCount=${this.tasks.size}`);
  }

  listTasks(): CronTaskWithPaths[] {
    return Array.from(this.tasks.values()).map((s) => s.task);
  }

  async addTask(
    definition: Omit<CronTaskDefinition, "id"> & { id?: string }
  ): Promise<CronTaskWithPaths> {
    const taskId = definition.id ?? await this.store.generateTaskIdFromName(definition.name);
    const task = await this.store.createTask(taskId, {
      name: definition.name,
      taskUid: definition.taskUid,
      description: definition.description,
      schedule: definition.schedule,
      prompt: definition.prompt,
      enabled: definition.enabled,
      deleteAfterRun: definition.deleteAfterRun
    });

    if (task.enabled !== false && this.started && !this.stopped) {
      this.scheduleTask(task);
      this.scheduleNextTick();
    }

    return task;
  }

  async deleteTask(taskId: string): Promise<boolean> {
    this.tasks.delete(taskId);
    this.runningTasks.delete(taskId);
    const deleted = await this.store.deleteTask(taskId);
    if (this.started && !this.stopped) {
      this.scheduleNextTick();
    }
    return deleted;
  }

  getTaskContext(taskId: string): CronTaskContext | null {
    const scheduled = this.tasks.get(taskId);
    if (!scheduled) {
      return null;
    }

    return {
      taskId: scheduled.task.id,
      taskUid: scheduled.task.taskUid,
      taskName: scheduled.task.name,
      prompt: scheduled.task.prompt,
      memoryPath: scheduled.task.memoryPath,
      filesPath: scheduled.task.filesPath
    };
  }

  private scheduleTask(task: CronTaskWithPaths): void {
    const nextRun = cronTimeGetNext(task.schedule);
    if (!nextRun) {
      logger.warn({ taskId: task.id, schedule: task.schedule }, "Invalid cron schedule");
      void this.reportError(
        new Error(`Invalid cron schedule: ${task.schedule}`),
        task.id
      );
      return;
    }
    logger.debug({
      taskId: task.id,
      schedule: task.schedule,
      nextRun: nextRun.toISOString()
    }, "Scheduling task");
    this.tasks.set(task.id, { task, nextRun, timer: null });
  }

  private async executeTask(task: CronTaskWithPaths): Promise<void> {
    logger.debug(`executeTask() called taskId=${task.id}`);

    if (this.stopped) {
      logger.debug("Scheduler stopped, not executing");
      return;
    }

    const runAt = new Date();

    const context: MessageContext = {
      channelId: `cron:${task.id}`,
      userId: "cron",
      sessionId: task.taskUid
    };

    const taskContext: CronTaskContext = {
      taskId: task.id,
      taskUid: task.taskUid,
      taskName: task.name,
      prompt: task.prompt,
      memoryPath: task.memoryPath,
      filesPath: task.filesPath
    };

    try {
      logger.info({ taskId: task.id, name: task.name }, "Executing cron task");
      await this.onTask(taskContext, context);
      logger.debug(`Task execution completed taskId=${task.id}`);
    } catch (error) {
      logger.warn({ taskId: task.id, error }, "Cron task execution failed");
      await this.reportError(error, task.id);
    } finally {
      task.lastRunAt = runAt.toISOString();
      await this.store.recordRun(task.id, runAt);
      await this.onTaskComplete?.(task, runAt);
    }
  }

  private async reportError(error: unknown, taskId: string): Promise<void> {
    if (!this.onError) {
      return;
    }
    await this.onError(error, taskId);
  }

  private runTick(): void {
    if (this.stopped) {
      return;
    }

    const now = new Date();
    let nextDue: Date | null = null;
    for (const scheduled of this.tasks.values()) {
      if (now.getTime() >= scheduled.nextRun.getTime()) {
        const nextRun = cronTimeGetNext(scheduled.task.schedule, now);
        if (!nextRun) {
          logger.warn(
            { taskId: scheduled.task.id, schedule: scheduled.task.schedule },
            "Invalid cron schedule"
          );
          void this.reportError(
            new Error(`Invalid cron schedule: ${scheduled.task.schedule}`),
            scheduled.task.id
          );
        } else {
          scheduled.nextRun = nextRun;
          this.tasks.set(scheduled.task.id, scheduled);
        }

        if (this.runningTasks.has(scheduled.task.id)) {
          continue;
        }

        if (scheduled.task.deleteAfterRun) {
          this.tasks.delete(scheduled.task.id);
        }

        this.runningTasks.add(scheduled.task.id);
        void this.executeTask(scheduled.task)
          .catch(() => {})
          .finally(() => {
            this.runningTasks.delete(scheduled.task.id);
            if (scheduled.task.deleteAfterRun) {
              this.tasks.delete(scheduled.task.id);
              void this.store.deleteTask(scheduled.task.id).catch((error) => {
                logger.warn(
                  { taskId: scheduled.task.id, error },
                  "Failed to delete cron task"
                );
              });
            }
          });
      }

      if (!nextDue || scheduled.nextRun.getTime() < nextDue.getTime()) {
        nextDue = scheduled.nextRun;
      }
    }

    this.scheduleNextTick(nextDue);
  }

  private scheduleNextTick(nextDue?: Date | null): void {
    if (this.stopped) {
      return;
    }
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
    }

    const now = new Date();
    const delay = nextDue ? nextDue.getTime() - now.getTime() : 60 * 1000;
    const waitMs = Math.max(0, Math.min(delay, 60 * 1000));
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      this.runTick();
    }, waitMs);
  }
}
