/**
 * Central type definitions for the heartbeat module.
 */

import type { ExecGateDefinition, SessionPermissions } from "@/types";
import type { ExecGateCheckInput, ExecGateCheckResult } from "../scheduling/execGateCheck.js";

export type HeartbeatDefinition = {
  id: string;
  title: string;
  prompt: string;
  filePath: string;
  gate?: ExecGateDefinition;
  lastRunAt?: string;
};

export type HeartbeatState = {
  lastRunAt?: string;
};

export type HeartbeatSchedulerOptions = {
  store: HeartbeatStoreInterface;
  intervalMs?: number;
  defaultPermissions: SessionPermissions;
  onRun: (tasks: HeartbeatDefinition[], runAt: Date) => void | Promise<void>;
  onError?: (error: unknown, taskIds?: string[]) => void | Promise<void>;
  onTaskComplete?: (task: HeartbeatDefinition, runAt: Date) => void | Promise<void>;
  gateCheck?: (input: ExecGateCheckInput) => Promise<ExecGateCheckResult>;
};

export type HeartbeatCreateTaskArgs = {
  id?: string;
  title: string;
  prompt: string;
  gate?: ExecGateDefinition;
  overwrite?: boolean;
};

/**
 * Interface for HeartbeatStore to allow dependency injection.
 */
export interface HeartbeatStoreInterface {
  ensureDir(): Promise<void>;
  listTasks(): Promise<HeartbeatDefinition[]>;
  createTask(definition: HeartbeatCreateTaskArgs): Promise<HeartbeatDefinition>;
  deleteTask(taskId: string): Promise<boolean>;
  loadTask(filePath: string, state?: HeartbeatState): Promise<HeartbeatDefinition | null>;
  recordRun(runAt: Date): Promise<void>;
}
