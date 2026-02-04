import path from "node:path";

import { getLogger } from "../../log.js";
import type { EngineEventBus } from "../ipc/events.js";
import type { Config, SessionPermissions } from "@/types";
import { CronScheduler } from "./ops/cronScheduler.js";
import { CronStore } from "./ops/cronStore.js";
import type { CronTaskDefinition, CronTaskWithPaths } from "./cronTypes.js";
import type { AgentSystem } from "../agents/agentSystem.js";
import { permissionBuildCron } from "../permissions/permissionBuildCron.js";

const logger = getLogger("cron.facade");

export type CronsOptions = {
  config: Config;
  eventBus: EngineEventBus;
  agentSystem: AgentSystem;
};

/**
 * Coordinates cron storage + scheduling for engine runtime.
 * Posts cron task prompts directly to the agent system.
 */
export class Crons {
  private readonly eventBus: EngineEventBus;
  private readonly agentSystem: AgentSystem;
  private readonly scheduler: CronScheduler;
  private readonly store: CronStore;

  constructor(options: CronsOptions) {
    this.eventBus = options.eventBus;
    this.agentSystem = options.agentSystem;
    const basePath = path.join(options.config.configDir, "cron");
    this.store = new CronStore(basePath);
    this.scheduler = new CronScheduler({
      store: this.store,
      defaultPermissions: options.config.defaultPermissions,
      resolvePermissions: async (task) => {
        if (task.agentId) {
          return this.agentSystem.permissionsForTarget({ agentId: task.agentId });
        }
        const base = permissionBuildCron(options.config.defaultPermissions, task.filesPath);
        const current = await this.agentSystem.permissionsForTarget({
          descriptor: { type: "cron", id: task.taskUid }
        });
        return mergeCronPermissions(base, current);
      },
      onTask: async (task, messageContext) => {
        const target = task.agentId
          ? { agentId: task.agentId }
          : { descriptor: { type: "cron" as const, id: task.taskUid } };
        logger.debug(
          `CronScheduler.onTask triggered taskUid=${task.taskUid} agentId=${task.agentId ?? "cron"}`
        );
        await this.agentSystem.postAndAwait(
          target,
          {
            type: "message",
            message: { text: task.prompt },
            context: messageContext
          }
        );
      },
      onError: async (error, taskId) => {
        logger.warn({ taskId, error }, "Cron task failed");
      },
      onGatePermissionSkip: async (task, missing) => {
        const label = task.name ? `"${task.name}" (${task.id})` : task.id;
        const notice = `Cron gate permissions not allowed for ${label}: ${missing.join(
          ", "
        )}. The gate check was skipped and the task ran anyway.`;
        const target = task.agentId
          ? { agentId: task.agentId }
          : { descriptor: { type: "cron" as const, id: task.taskUid } };
        await this.agentSystem.post(target, {
          type: "system_message",
          text: notice,
          origin: "system",
          silent: true
        });
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

function mergeCronPermissions(
  base: SessionPermissions,
  current: SessionPermissions
): SessionPermissions {
  const writeDirs = new Set([...base.writeDirs, ...current.writeDirs]);
  const readDirs = new Set([...base.readDirs, ...current.readDirs]);
  return {
    workingDir: base.workingDir,
    writeDirs: Array.from(writeDirs.values()),
    readDirs: Array.from(readDirs.values()),
    web: base.web || current.web
  };
}
