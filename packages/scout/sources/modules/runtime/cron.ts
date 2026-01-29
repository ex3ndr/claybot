import type {
  ConnectorMessage,
  MessageContext
} from "../../connectors/types.js";

export type CronTaskConfig = {
  id?: string;
  everyMs: number;
  message?: string;
  channelId?: string;
  sessionId?: string;
  userId?: string | null;
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
  private onMessage: CronSchedulerOptions["onMessage"];
  private actions: Record<string, CronAction>;
  private onError?: CronSchedulerOptions["onError"];

  constructor(options: CronSchedulerOptions) {
    this.tasks = CronScheduler.normalizeTasks(options.tasks);
    this.onMessage = options.onMessage;
    this.actions = options.actions ?? {};
    this.onError = options.onError;
  }

  start(): void {
    if (this.started || this.stopped) {
      return;
    }

    this.started = true;

    for (const task of this.tasks) {
      if (task.enabled === false) {
        continue;
      }

      if (!this.isValidInterval(task.everyMs)) {
        void this.reportError(
          new Error(`Invalid interval for task ${task.id}`),
          task
        );
        continue;
      }

      if (task.runOnStart) {
        void this.dispatchTask(task);
      }

      if (task.once) {
        if (!task.runOnStart) {
          const timer = setTimeout(() => {
            void this.dispatchTask(task).finally(() => {
              this.timers.delete(task.id);
            });
          }, task.everyMs);
          this.timers.set(task.id, timer);
        }
      } else {
        const timer = setInterval(() => {
          void this.dispatchTask(task);
        }, task.everyMs);
        this.timers.set(task.id, timer);
      }
    }
  }

  stop(): void {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  private async dispatchTask(task: CronTask): Promise<void> {
    if (this.stopped) {
      return;
    }

    const context: MessageContext = {
      channelId: task.channelId ?? task.sessionId ?? `cron:${task.id}`,
      userId: task.userId ?? null,
      sessionId: task.sessionId
    };

    if (task.action) {
      const handler = this.actions[task.action];
      if (!handler) {
        await this.reportError(
          new Error(`Missing cron action handler: ${task.action}`),
          task
        );
        return;
      }
      await handler(task, context);
      return;
    }

    if (typeof task.message !== "string") {
      await this.reportError(
        new Error(`Missing message for cron task ${task.id}`),
        task
      );
      return;
    }

    const message: ConnectorMessage = {
      text: task.message
    };

    await this.onMessage(message, context, task);
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

  private isValidInterval(value: number): boolean {
    return Number.isFinite(value) && value > 0;
  }

  private static normalizeTasks(tasks: CronTaskConfig[]): CronTask[] {
    return tasks.map((task, index) => ({
      ...task,
      id: task.id ?? `task-${index + 1}`,
      everyMs: task.everyMs
    }));
  }
}
