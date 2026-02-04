import path from "node:path";

import { getLogger } from "../../log.js";
import type { EngineEventBus } from "../ipc/events.js";
import { heartbeatPromptBuildBatch } from "./ops/heartbeatPromptBuildBatch.js";
import { HeartbeatScheduler } from "./ops/heartbeatScheduler.js";
import { HeartbeatStore } from "./ops/heartbeatStore.js";
import type { HeartbeatCreateTaskArgs, HeartbeatDefinition } from "./heartbeatTypes.js";
import type { Config } from "@/types";
import type { AgentSystem } from "../agents/agentSystem.js";
import { gatePermissionErrorIs } from "../scheduling/gatePermissionErrorIs.js";

const logger = getLogger("heartbeat.facade");

export type HeartbeatsOptions = {
  config: Config;
  eventBus: EngineEventBus;
  agentSystem: AgentSystem;
  intervalMs?: number;
};

/**
 * Coordinates heartbeat storage + scheduling for engine runtime.
 * Posts heartbeat prompts directly to the agent system.
 */
export class Heartbeats {
  private readonly eventBus: EngineEventBus;
  private readonly agentSystem: AgentSystem;
  private readonly scheduler: HeartbeatScheduler;
  private readonly store: HeartbeatStore;

  constructor(options: HeartbeatsOptions) {
    this.eventBus = options.eventBus;
    this.agentSystem = options.agentSystem;
    const basePath = path.join(options.config.configDir, "heartbeat");
    this.store = new HeartbeatStore(basePath);
    this.scheduler = new HeartbeatScheduler({
      store: this.store,
      intervalMs: options.intervalMs,
      defaultPermissions: options.config.defaultPermissions,
      resolvePermissions: async () =>
        this.agentSystem.permissionsForTarget({ descriptor: { type: "heartbeat" } }),
      onRun: async (tasks) => {
        const batch = heartbeatPromptBuildBatch(tasks);
        await this.agentSystem.postAndAwait(
          { descriptor: { type: "heartbeat" } },
          {
            type: "message",
            message: { text: batch.prompt },
            context: {}
          }
        );
      },
      onError: async (error, taskIds) => {
        if (!gatePermissionErrorIs(error)) {
          logger.warn({ taskIds, error }, "Heartbeat task failed");
          return;
        }
        logger.warn(
          { taskIds, error },
          "Heartbeat gate permissions not satisfied; continuing without gate"
        );
        const missing = error.missing.join(", ");
        const taskList = taskIds && taskIds.length > 0 ? taskIds.join(", ") : "unknown";
        const notice =
          `Heartbeat gate permissions not allowed: ${missing}. ` +
          "The gate check was skipped and the heartbeat ran anyway. " +
          `Tasks: ${taskList}.`;
        await this.agentSystem.post(
          { descriptor: { type: "heartbeat" } },
          {
            type: "system_message",
            text: notice,
            origin: "system",
            silent: true
          }
        );
      },
      onTaskComplete: (task, runAt) => {
        this.eventBus.emit("heartbeat.task.ran", { taskId: task.id, runAt: runAt.toISOString() });
      }
    });
  }

  async ensureDir(): Promise<void> {
    await this.store.ensureDir();
  }

  async start(): Promise<void> {
    await this.scheduler.start();
    const tasks = await this.listTasks();
    this.eventBus.emit("heartbeat.started", { tasks });
    if (tasks.length === 0) {
      logger.info("No heartbeat tasks found on boot.");
      return;
    }
    const withLastRun = tasks.filter((task) => !!task.lastRunAt);
    const missingLastRun = tasks.filter((task) => !task.lastRunAt);
    if (withLastRun.length > 0) {
      const mostRecent = withLastRun
        .map((task) => task.lastRunAt as string)
        .sort()
        .at(-1);
      logger.info(
        {
          taskCount: tasks.length,
          mostRecentRunAt: mostRecent
        },
        "Heartbeat last run loaded on boot"
      );
    }
    if (missingLastRun.length > 0) {
      logger.info(
        {
          taskCount: missingLastRun.length,
          taskIds: missingLastRun.map((task) => task.id)
        },
        "Heartbeat missing last run info; running now"
      );
      await this.runNow({ ids: missingLastRun.map((task) => task.id) });
    }
    const nextRunAt =
      this.scheduler.getNextRunAt() ??
      new Date(Date.now() + this.scheduler.getIntervalMs());
    logger.info({ nextRunAt: nextRunAt.toISOString() }, "Next heartbeat run scheduled");
  }

  stop(): void {
    this.scheduler.stop();
  }

  async listTasks(): Promise<HeartbeatDefinition[]> {
    return this.store.listTasks();
  }

  async runNow(args?: { ids?: string[] }): Promise<{ ran: number; taskIds: string[] }> {
    return this.scheduler.runNow(args?.ids);
  }

  async addTask(args: HeartbeatCreateTaskArgs): Promise<HeartbeatDefinition> {
    return this.store.createTask(args);
  }

  async removeTask(taskId: string): Promise<boolean> {
    return this.store.deleteTask(taskId);
  }
}
