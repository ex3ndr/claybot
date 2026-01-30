import type {
  ConnectorMessage,
  MessageContext
} from "../../engine/connectors/types.js";
import { getLogger } from "../../log.js";

const logger = getLogger("cron.scheduler");

export type CronTaskConfig = {
  id?: string;
  everyMs: number;
  message?: string;
  channelId?: string;
  sessionId?: string;
  userId?: string | null;
  source?: string;
  enabled?: boolean;
  runOnStart?: boolean;
  once?: boolean;
  action?: string;
  payload?: Record<string, unknown>;
};

export type CronAction = (
  task: CronTaskConfig,
  context: MessageContext
) => void | Promise<void>;

export type CronSchedulerOptions = {
  tasks: CronTaskConfig[];
  onMessage: (
    message: ConnectorMessage,
    context: MessageContext,
    task: CronTaskConfig
  ) => void | Promise<void>;
  actions?: Record<string, CronAction>;
  onError?: (error: unknown, task: CronTaskConfig) => void | Promise<void>;
};

type CronTask = Required<Pick<CronTaskConfig, "id" | "everyMs">> &
  CronTaskConfig;

export class CronScheduler {
  private tasks: CronTask[];
  private timers = new Map<string, NodeJS.Timeout>();
  private started = false;
  private stopped = false;
  private taskCounter = 0;
  private onMessage: CronSchedulerOptions["onMessage"];
  private actions: Record<string, CronAction>;
  private onError?: CronSchedulerOptions["onError"];

  constructor(options: CronSchedulerOptions) {
    this.tasks = CronScheduler.normalizeTasks(options.tasks);
    this.taskCounter = CronScheduler.seedTaskCounter(this.tasks);
    this.onMessage = options.onMessage;
    this.actions = options.actions ?? {};
    this.onError = options.onError;
    logger.debug(
      { taskCount: this.tasks.length, actionCount: Object.keys(this.actions).length },
      "[VERBOSE] CronScheduler initialized"
    );
  }

  start(): void {
    logger.debug({ started: this.started, stopped: this.stopped }, "[VERBOSE] start() called");
    if (this.started || this.stopped) {
      logger.debug("[VERBOSE] Already started or stopped, returning");
      return;
    }

    this.started = true;
    logger.debug({ taskCount: this.tasks.length }, "[VERBOSE] Scheduling tasks");

    for (const task of this.tasks) {
      if (task.enabled === false) {
        logger.debug({ taskId: task.id }, "[VERBOSE] Task disabled, skipping");
        continue;
      }

      this.scheduleTask(task);
    }
    logger.debug("[VERBOSE] All tasks scheduled");
  }

  stop(): void {
    logger.debug({ stopped: this.stopped }, "[VERBOSE] stop() called");
    if (this.stopped) {
      logger.debug("[VERBOSE] Already stopped, returning");
      return;
    }

    this.stopped = true;
    logger.debug({ timerCount: this.timers.size }, "[VERBOSE] Clearing timers");
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    logger.debug("[VERBOSE] CronScheduler stopped");
  }

  addTask(task: CronTaskConfig): CronTask {
    logger.debug({ taskId: task.id, everyMs: task.everyMs, action: task.action }, "[VERBOSE] addTask() called");
    const normalized = this.normalizeTask(task);

    if (this.tasks.some((existing) => existing.id === normalized.id)) {
      logger.debug({ taskId: normalized.id }, "[VERBOSE] Task already exists");
      throw new Error(`Cron task already exists: ${normalized.id}`);
    }

    this.tasks.push(normalized);
    logger.debug({ taskId: normalized.id, totalTasks: this.tasks.length }, "[VERBOSE] Task added");

    if (this.started && !this.stopped && normalized.enabled !== false) {
      logger.debug({ taskId: normalized.id }, "[VERBOSE] Scheduling newly added task");
      this.scheduleTask(normalized);
    }

    return normalized;
  }

  listTasks(): CronTaskConfig[] {
    return this.tasks.map((task) => ({ ...task }));
  }

  private async dispatchTask(task: CronTask): Promise<void> {
    logger.debug({ taskId: task.id, stopped: this.stopped }, "[VERBOSE] dispatchTask() called");
    if (this.stopped) {
      logger.debug("[VERBOSE] Scheduler stopped, not dispatching");
      return;
    }

    const context: MessageContext = {
      channelId: task.channelId ?? task.sessionId ?? `cron:${task.id}`,
      userId: task.userId ?? null,
      sessionId: task.sessionId
    };
    logger.debug({ taskId: task.id, channelId: context.channelId, sessionId: context.sessionId }, "[VERBOSE] Built message context");

    if (task.action) {
      logger.debug({ taskId: task.id, action: task.action }, "[VERBOSE] Dispatching action task");
      const handler = this.actions[task.action];
      if (!handler) {
        logger.debug({ taskId: task.id, action: task.action }, "[VERBOSE] Action handler not found");
        await this.reportError(
          new Error(`Missing cron action handler: ${task.action}`),
          task
        );
        return;
      }
      logger.debug({ taskId: task.id, action: task.action }, "[VERBOSE] Calling action handler");
      await handler(task, context);
      logger.debug({ taskId: task.id }, "[VERBOSE] Action handler completed");
      return;
    }

    if (typeof task.message !== "string") {
      logger.debug({ taskId: task.id }, "[VERBOSE] No message for task");
      await this.reportError(
        new Error(`Missing message for cron task ${task.id}`),
        task
      );
      return;
    }

    const message: ConnectorMessage = {
      text: task.message
    };

    logger.debug({ taskId: task.id, messageLength: task.message.length }, "[VERBOSE] Dispatching message task");
    await this.onMessage(message, context, task);
    logger.debug({ taskId: task.id }, "[VERBOSE] Message task dispatched");
  }

  private async reportError(
    error: unknown,
    task: CronTaskConfig
  ): Promise<void> {
    if (!this.onError) {
      return;
    }
    await this.onError(error, task);
  }

  private scheduleTask(task: CronTask): void {
    logger.debug({ taskId: task.id, everyMs: task.everyMs, once: task.once, runOnStart: task.runOnStart }, "[VERBOSE] scheduleTask() called");
    if (!this.isValidInterval(task.everyMs)) {
      logger.debug({ taskId: task.id, everyMs: task.everyMs }, "[VERBOSE] Invalid interval");
      void this.reportError(
        new Error(`Invalid interval for task ${task.id}`),
        task
      );
      return;
    }

    if (task.runOnStart) {
      logger.debug({ taskId: task.id }, "[VERBOSE] Running task on start");
      void this.dispatchTask(task);
    }

    if (task.once) {
      if (!task.runOnStart) {
        logger.debug({ taskId: task.id, delayMs: task.everyMs }, "[VERBOSE] Scheduling one-time task");
        const timer = setTimeout(() => {
          logger.debug({ taskId: task.id }, "[VERBOSE] One-time task timer fired");
          void this.dispatchTask(task).finally(() => {
            this.timers.delete(task.id);
            logger.debug({ taskId: task.id }, "[VERBOSE] One-time task timer removed");
          });
        }, task.everyMs);
        this.timers.set(task.id, timer);
      }
    } else {
      logger.debug({ taskId: task.id, intervalMs: task.everyMs }, "[VERBOSE] Scheduling recurring task");
      const timer = setInterval(() => {
        logger.debug({ taskId: task.id }, "[VERBOSE] Recurring task timer fired");
        void this.dispatchTask(task);
      }, task.everyMs);
      this.timers.set(task.id, timer);
    }
    logger.debug({ taskId: task.id, timerCount: this.timers.size }, "[VERBOSE] Task scheduled");
  }

  private isValidInterval(value: number): boolean {
    return Number.isFinite(value) && value > 0;
  }

  private normalizeTask(task: CronTaskConfig): CronTask {
    return {
      ...task,
      id: task.id ?? this.nextTaskId(),
      everyMs: task.everyMs
    };
  }

  private nextTaskId(): string {
    let candidate = this.taskCounter + 1;
    let id = `task-${candidate}`;

    while (this.tasks.some((task) => task.id === id)) {
      candidate += 1;
      id = `task-${candidate}`;
    }

    this.taskCounter = candidate;
    return id;
  }

  private static normalizeTasks(tasks: CronTaskConfig[]): CronTask[] {
    return tasks.map((task, index) => ({
      ...task,
      id: task.id ?? `task-${index + 1}`,
      everyMs: task.everyMs
    }));
  }

  private static seedTaskCounter(tasks: CronTask[]): number {
    let max = 0;
    for (const task of tasks) {
      const match = /^task-(\d+)$/.exec(task.id);
      if (match) {
        const value = Number(match[1]);
        if (Number.isFinite(value) && value > max) {
          max = value;
        }
      }
    }
    return Math.max(max, tasks.length);
  }
}
