import type { ExecGateDefinition } from "@/types";

/**
 * Cron task definition as stored/provided by the user.
 */
export type CronTaskDefinition = {
  id: string;
  taskUid?: string;
  name: string;
  description?: string;
  schedule: string;
  prompt: string;
  agentId?: string;
  gate?: ExecGateDefinition;
  enabled?: boolean;
  deleteAfterRun?: boolean;
};

/**
 * Cron task with computed paths for file storage.
 */
export type CronTaskWithPaths = Omit<CronTaskDefinition, "taskUid"> & {
  taskUid: string;
  taskPath: string;
  memoryPath: string;
  filesPath: string;
  lastRunAt?: string;
};

/**
 * Internal state persisted for each cron task.
 */
export type CronTaskState = {
  lastRunAt?: string;
};

/**
 * Context passed to task handlers when a cron task executes.
 */
export type CronTaskContext = {
  taskId: string;
  taskUid: string;
  taskName: string;
  prompt: string;
  memoryPath: string;
  filesPath: string;
  agentId?: string;
};

/**
 * Simple key-value frontmatter from markdown files.
 */
export type Frontmatter = Record<string, unknown>;

/**
 * Parsed markdown document with frontmatter and body.
 */
export type ParsedDocument = {
  frontmatter: Frontmatter;
  body: string;
};

/**
 * A single field from a parsed cron expression.
 */
export type CronField = {
  values: Set<number>;
  any: boolean;
};

/**
 * Parsed 5-field cron expression.
 */
export type ParsedCron = {
  minute: CronField;
  hour: CronField;
  day: CronField;
  month: CronField;
  weekday: CronField;
};

/**
 * Internal tracking for a scheduled task in the scheduler.
 */
export type ScheduledTask = {
  task: CronTaskWithPaths;
  nextRun: Date;
  timer: NodeJS.Timeout | null;
};
