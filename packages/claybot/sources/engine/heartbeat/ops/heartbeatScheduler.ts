import { getLogger } from "../../../log.js";
import type {
  HeartbeatDefinition,
  HeartbeatSchedulerOptions,
  HeartbeatStoreInterface
} from "../heartbeatTypes.js";
import { execGateCheck } from "../../scheduling/execGateCheck.js";

const logger = getLogger("heartbeat.scheduler");

/**
 * Manages interval-based heartbeat task execution.
 *
 * Runs all heartbeat tasks in a single batch at regular intervals.
 */
export class HeartbeatScheduler {
  private store: HeartbeatStoreInterface;
  private intervalMs: number;
  private onRun: HeartbeatSchedulerOptions["onRun"];
  private onError?: HeartbeatSchedulerOptions["onError"];
  private onTaskComplete?: HeartbeatSchedulerOptions["onTaskComplete"];
  private defaultPermissions: HeartbeatSchedulerOptions["defaultPermissions"];
  private gateCheck: HeartbeatSchedulerOptions["gateCheck"];
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private stopped = false;
  private running = false;
  private nextRunAt: Date | null = null;

  constructor(options: HeartbeatSchedulerOptions) {
    this.store = options.store;
    this.intervalMs = options.intervalMs ?? 30 * 60 * 1000;
    this.onRun = options.onRun;
    this.onError = options.onError;
    this.onTaskComplete = options.onTaskComplete;
    this.defaultPermissions = options.defaultPermissions;
    this.gateCheck = options.gateCheck ?? execGateCheck;
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

  getIntervalMs(): number {
    return this.intervalMs;
  }

  getNextRunAt(): Date | null {
    return this.nextRunAt;
  }

  private scheduleNext(): void {
    if (this.stopped) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.nextRunAt = new Date(Date.now() + this.intervalMs);
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
      const gated = await this.filterByGate(filtered);
      if (gated.length === 0) {
        return { ran: 0, taskIds: [] };
      }
      const runAt = new Date();
      const ids = gated.map((task) => task.id);
      logger.info(
        {
          taskCount: gated.length,
          taskIds: ids
        },
        "Heartbeat run started"
      );
      try {
        await this.onRun(gated, runAt);
      } catch (error) {
        logger.warn({ taskIds: ids, error }, "Heartbeat run failed");
        await this.onError?.(error, ids);
      } finally {
        await this.store.recordRun(runAt);
        for (const task of gated) {
          task.lastRunAt = runAt.toISOString();
          await this.onTaskComplete?.(task, runAt);
        }
      }
      logger.info(
        {
          taskCount: filtered.length,
          taskIds: ids
        },
        "Heartbeat run completed"
      );
      return { ran: gated.length, taskIds: ids };
    } catch (error) {
      logger.warn({ error }, "Heartbeat run failed");
      await this.onError?.(error, undefined);
      return { ran: 0, taskIds: [] };
    } finally {
      this.running = false;
    }
  }

  private async filterByGate(tasks: HeartbeatDefinition[]): Promise<HeartbeatDefinition[]> {
    const eligible: HeartbeatDefinition[] = [];
    for (const task of tasks) {
      if (!task.gate) {
        eligible.push(task);
        continue;
      }
      const result = await this.gateCheck?.({
        gate: task.gate,
        permissions: this.defaultPermissions,
        workingDir: this.defaultPermissions.workingDir
      });
      if (!result) {
        eligible.push(task);
        continue;
      }
      if (result.error) {
        logger.warn({ taskId: task.id, error: result.error }, "Heartbeat gate failed");
        await this.onError?.(result.error, [task.id]);
        continue;
      }
      if (!result.shouldRun) {
        logger.debug(
          { taskId: task.id, exitCode: result.exitCode },
          "Heartbeat gate skipped execution"
        );
        continue;
      }
      eligible.push(task);
    }
    return eligible;
  }
}
