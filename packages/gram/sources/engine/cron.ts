import { createId } from "@paralleldrive/cuid2";

import type { MessageContext } from "./connectors/types.js";
import { getLogger } from "../log.js";
import {
  CronStore,
  type CronTaskDefinition,
  type CronTaskWithPaths
} from "./cron-store.js";

const logger = getLogger("cron.scheduler");

export type CronTaskContext = {
  taskId: string;
  taskName: string;
  prompt: string;
  memoryPath: string;
  filesPath: string;
};

export type CronSchedulerOptions = {
  store: CronStore;
  onTask: (
    context: CronTaskContext,
    messageContext: MessageContext
  ) => void | Promise<void>;
  onError?: (error: unknown, taskId: string) => void | Promise<void>;
};

type ScheduledTask = {
  task: CronTaskWithPaths;
  nextRun: Date;
  timer: NodeJS.Timeout | null;
};

export class CronScheduler {
  private store: CronStore;
  private tasks = new Map<string, ScheduledTask>();
  private started = false;
  private stopped = false;
  private onTask: CronSchedulerOptions["onTask"];
  private onError?: CronSchedulerOptions["onError"];

  constructor(options: CronSchedulerOptions) {
    this.store = options.store;
    this.onTask = options.onTask;
    this.onError = options.onError;
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

    for (const scheduled of this.tasks.values()) {
      if (scheduled.timer) {
        clearTimeout(scheduled.timer);
      }
    }
    this.tasks.clear();
    logger.debug("CronScheduler stopped");
  }

  async reload(): Promise<void> {
    logger.debug("Reloading tasks from disk");

    // Cancel all existing timers
    for (const scheduled of this.tasks.values()) {
      if (scheduled.timer) {
        clearTimeout(scheduled.timer);
      }
    }
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

    logger.debug(`Tasks reloaded taskCount=${this.tasks.size}`);
  }

  listTasks(): CronTaskWithPaths[] {
    return Array.from(this.tasks.values()).map((s) => s.task);
  }

  async addTask(
    definition: Omit<CronTaskDefinition, "id"> & { id?: string }
  ): Promise<CronTaskWithPaths> {
    const taskId = definition.id ?? createId();
    const task = await this.store.createTask(taskId, {
      name: definition.name,
      schedule: definition.schedule,
      prompt: definition.prompt,
      enabled: definition.enabled
    });

    if (task.enabled !== false && this.started && !this.stopped) {
      this.scheduleTask(task);
    }

    return task;
  }

  getTaskContext(taskId: string): CronTaskContext | null {
    const scheduled = this.tasks.get(taskId);
    if (!scheduled) {
      return null;
    }

    return {
      taskId: scheduled.task.id,
      taskName: scheduled.task.name,
      prompt: scheduled.task.prompt,
      memoryPath: scheduled.task.memoryPath,
      filesPath: scheduled.task.filesPath
    };
  }

  private scheduleTask(task: CronTaskWithPaths): void {
    const existing = this.tasks.get(task.id);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    const nextRun = getNextCronTime(task.schedule);
    if (!nextRun) {
      logger.warn({ taskId: task.id, schedule: task.schedule }, "Invalid cron schedule");
      void this.reportError(
        new Error(`Invalid cron schedule: ${task.schedule}`),
        task.id
      );
      return;
    }

    const now = new Date();
    const delay = nextRun.getTime() - now.getTime();

    logger.debug({
      taskId: task.id,
      schedule: task.schedule,
      nextRun: nextRun.toISOString(),
      delayMs: delay
    }, "Scheduling task");

    const timer = setTimeout(() => {
      void this.executeTask(task);
    }, Math.max(delay, 0));

    this.tasks.set(task.id, { task, nextRun, timer });
  }

  private async executeTask(task: CronTaskWithPaths): Promise<void> {
    logger.debug(`executeTask() called taskId=${task.id}`);

    if (this.stopped) {
      logger.debug("Scheduler stopped, not executing");
      return;
    }

    const context: MessageContext = {
      channelId: `cron:${task.id}`,
      userId: null,
      sessionId: `cron:${task.id}`
    };

    const taskContext: CronTaskContext = {
      taskId: task.id,
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
    }

    // Reschedule for next run
    if (!this.stopped) {
      this.scheduleTask(task);
    }
  }

  private async reportError(error: unknown, taskId: string): Promise<void> {
    if (!this.onError) {
      return;
    }
    await this.onError(error, taskId);
  }
}

// Simple cron parser for 5-field format: minute hour day month weekday
type CronField = {
  values: Set<number>;
  any: boolean;
};

type ParsedCron = {
  minute: CronField;
  hour: CronField;
  day: CronField;
  month: CronField;
  weekday: CronField;
};

function parseCronExpression(expression: string): ParsedCron | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }

  const [minuteStr, hourStr, dayStr, monthStr, weekdayStr] = parts;

  const minute = parseField(minuteStr!, 0, 59);
  const hour = parseField(hourStr!, 0, 23);
  const day = parseField(dayStr!, 1, 31);
  const month = parseField(monthStr!, 1, 12);
  const weekday = parseField(weekdayStr!, 0, 6);

  if (!minute || !hour || !day || !month || !weekday) {
    return null;
  }

  return { minute, hour, day, month, weekday };
}

function parseField(field: string, min: number, max: number): CronField | null {
  if (field === "*") {
    return { values: new Set(), any: true };
  }

  const values = new Set<number>();

  // Handle step values like */5
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step <= 0) {
      return null;
    }
    for (let i = min; i <= max; i += step) {
      values.add(i);
    }
    return { values, any: false };
  }

  // Handle comma-separated values
  const parts = field.split(",");
  for (const part of parts) {
    // Handle ranges like 1-5
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = parseInt(startStr!, 10);
      const end = parseInt(endStr!, 10);
      if (isNaN(start) || isNaN(end) || start < min || end > max || start > end) {
        return null;
      }
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
    } else {
      const value = parseInt(part, 10);
      if (isNaN(value) || value < min || value > max) {
        return null;
      }
      values.add(value);
    }
  }

  return { values, any: false };
}

function matchesField(field: CronField, value: number): boolean {
  return field.any || field.values.has(value);
}

function getNextCronTime(expression: string, from?: Date): Date | null {
  const parsed = parseCronExpression(expression);
  if (!parsed) {
    return null;
  }

  const start = from ?? new Date();
  const candidate = new Date(start);

  // Start from next minute
  candidate.setSeconds(0);
  candidate.setMilliseconds(0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Search for next matching time (max 2 years to prevent infinite loop)
  const maxIterations = 365 * 24 * 60 * 2;

  for (let i = 0; i < maxIterations; i++) {
    const month = candidate.getMonth() + 1; // 1-12
    const day = candidate.getDate();
    const weekday = candidate.getDay(); // 0-6
    const hour = candidate.getHours();
    const minute = candidate.getMinutes();

    if (
      matchesField(parsed.month, month) &&
      matchesField(parsed.day, day) &&
      matchesField(parsed.weekday, weekday) &&
      matchesField(parsed.hour, hour) &&
      matchesField(parsed.minute, minute)
    ) {
      return candidate;
    }

    // Advance by one minute
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

export { getNextCronTime, parseCronExpression };

// Re-export types from old API for backward compatibility during migration
export type { CronTaskDefinition as CronTaskConfig };
