import { promises as fs } from "node:fs";
import path from "node:path";

import { getLogger } from "../log.js";

const logger = getLogger("cron.store");

export type CronTaskDefinition = {
  id: string;
  name: string;
  description?: string;
  schedule: string;
  prompt: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
};

export type CronTaskWithPaths = CronTaskDefinition & {
  taskPath: string;
  memoryPath: string;
  filesPath: string;
  lastRunAt?: string;
};

type CronTaskState = {
  lastRunAt?: string;
};

/**
 * Manages cron tasks stored as markdown files.
 *
 * Structure:
 * - /cron/<task-id>/TASK.md - frontmatter (name, schedule, enabled) + prompt body
 * - /cron/<task-id>/MEMORY.md - task memory (initialized with "No memory")
 * - /cron/<task-id>/files/ - workspace for task files
 */
export class CronStore {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  async listTasks(): Promise<CronTaskWithPaths[]> {
    await this.ensureDir();

    const entries = await fs.readdir(this.basePath, { withFileTypes: true });
    const tasks: CronTaskWithPaths[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const taskId = entry.name;
      const taskDir = path.join(this.basePath, taskId);
      const taskPath = path.join(taskDir, "TASK.md");

      try {
        const task = await this.loadTask(taskId);
        if (task) {
          tasks.push(task);
        }
      } catch (error) {
        logger.warn({ taskId, error }, "Failed to load cron task");
      }
    }

    return tasks;
  }

  async loadTask(taskId: string): Promise<CronTaskWithPaths | null> {
    const taskDir = path.join(this.basePath, taskId);
    const taskPath = path.join(taskDir, "TASK.md");
    const memoryPath = path.join(taskDir, "MEMORY.md");
    const filesPath = path.join(taskDir, "files");
    const state = await this.readState(taskId);

    try {
      const content = await fs.readFile(taskPath, "utf8");
      const parsed = parseFrontmatter(content);

      const schedule =
        parsed.frontmatter.schedule ?? parsed.frontmatter.cron;
      const deleteAfterRun =
        parsed.frontmatter.deleteAfterRun ??
        parsed.frontmatter.delete_after_run ??
        parsed.frontmatter.oneOff ??
        parsed.frontmatter.one_off ??
        parsed.frontmatter.once;
      if (!parsed.frontmatter.name || !schedule) {
        logger.warn({ taskId }, "Cron task missing required frontmatter fields");
        return null;
      }

      return {
        id: taskId,
        name: String(parsed.frontmatter.name),
        description: parsed.frontmatter.description
          ? String(parsed.frontmatter.description)
          : undefined,
        schedule: String(schedule),
        prompt: parsed.body.trim(),
        enabled: parsed.frontmatter.enabled !== false,
        deleteAfterRun: deleteAfterRun === true,
        taskPath,
        memoryPath,
        filesPath,
        lastRunAt: state.lastRunAt
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async createTask(
    taskId: string,
    definition: Omit<CronTaskDefinition, "id">
  ): Promise<CronTaskWithPaths> {
    const taskDir = path.join(this.basePath, taskId);
    const taskPath = path.join(taskDir, "TASK.md");
    const memoryPath = path.join(taskDir, "MEMORY.md");
    const filesPath = path.join(taskDir, "files");

    // Ensure task directory exists
    await fs.mkdir(taskDir, { recursive: true });
    await fs.mkdir(filesPath, { recursive: true });

    // Write TASK.md
    const frontmatter: Frontmatter = {
      name: definition.name,
      schedule: definition.schedule,
      enabled: definition.enabled ?? true
    };
    if (definition.description) {
      frontmatter.description = definition.description;
    }
    if (definition.deleteAfterRun) {
      frontmatter.deleteAfterRun = true;
    }
    const content = serializeFrontmatter(frontmatter, definition.prompt);
    await fs.writeFile(taskPath, content, "utf8");

    // Write initial MEMORY.md
    await fs.writeFile(memoryPath, "No memory\n", "utf8");

    logger.info({ taskId, name: definition.name }, "Cron task created");

    return {
      id: taskId,
      ...definition,
      enabled: definition.enabled ?? true,
      deleteAfterRun: definition.deleteAfterRun ?? false,
      taskPath,
      memoryPath,
      filesPath,
      lastRunAt: undefined
    };
  }

  async updateTask(
    taskId: string,
    updates: Partial<Omit<CronTaskDefinition, "id">>
  ): Promise<CronTaskWithPaths | null> {
    const existing = await this.loadTask(taskId);
    if (!existing) {
      return null;
    }

    const updated: CronTaskDefinition = {
      id: taskId,
      name: updates.name ?? existing.name,
      description: updates.description ?? existing.description,
      schedule: updates.schedule ?? existing.schedule,
      prompt: updates.prompt ?? existing.prompt,
      enabled: updates.enabled ?? existing.enabled,
      deleteAfterRun: updates.deleteAfterRun ?? existing.deleteAfterRun
    };

    const frontmatter: Frontmatter = {
      name: updated.name,
      schedule: updated.schedule,
      enabled: updated.enabled ?? true
    };
    if (updated.description) {
      frontmatter.description = updated.description;
    }
    if (updated.deleteAfterRun) {
      frontmatter.deleteAfterRun = true;
    }
    const content = serializeFrontmatter(frontmatter, updated.prompt);
    await fs.writeFile(existing.taskPath, content, "utf8");

    logger.info({ taskId }, "Cron task updated");

    return {
      ...updated,
      taskPath: existing.taskPath,
      memoryPath: existing.memoryPath,
      filesPath: existing.filesPath,
      lastRunAt: existing.lastRunAt
    };
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const taskDir = path.join(this.basePath, taskId);

    try {
      await fs.rm(taskDir, { recursive: true, force: true });
      logger.info({ taskId }, "Cron task deleted");
      return true;
    } catch (error) {
      logger.warn({ taskId, error }, "Failed to delete cron task");
      return false;
    }
  }

  async readMemory(taskId: string): Promise<string> {
    const memoryPath = path.join(this.basePath, taskId, "MEMORY.md");

    try {
      return await fs.readFile(memoryPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "No memory";
      }
      throw error;
    }
  }

  async writeMemory(taskId: string, content: string): Promise<void> {
    const taskDir = path.join(this.basePath, taskId);
    const memoryPath = path.join(taskDir, "MEMORY.md");

    // Ensure directory exists
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(memoryPath, content, "utf8");

    logger.debug({ taskId }, "Cron task memory updated");
  }

  async recordRun(taskId: string, runAt: Date): Promise<void> {
    await this.ensureDir();
    const state = await this.readState(taskId);
    state.lastRunAt = runAt.toISOString();
    await this.writeState(taskId, state);
  }

  getTaskPaths(taskId: string): { taskPath: string; memoryPath: string; filesPath: string } {
    const taskDir = path.join(this.basePath, taskId);
    return {
      taskPath: path.join(taskDir, "TASK.md"),
      memoryPath: path.join(taskDir, "MEMORY.md"),
      filesPath: path.join(taskDir, "files")
    };
  }

  async generateTaskIdFromName(name: string): Promise<string> {
    const base = slugify(name) || "cron-task";
    let candidate = base;
    let suffix = 2;
    while (!(await this.isTaskIdAvailable(candidate))) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private async isTaskIdAvailable(taskId: string): Promise<boolean> {
    const taskDir = path.join(this.basePath, taskId);
    try {
      const stat = await fs.stat(taskDir);
      return !stat.isDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return true;
      }
      throw error;
    }
  }

  private getStatePath(taskId: string): string {
    return path.join(this.basePath, taskId, "STATE.json");
  }

  private async readState(taskId: string): Promise<CronTaskState> {
    const statePath = this.getStatePath(taskId);
    try {
      const raw = await fs.readFile(statePath, "utf8");
      const parsed = JSON.parse(raw) as CronTaskState;
      if (parsed && typeof parsed === "object") {
        return {
          lastRunAt: typeof parsed.lastRunAt === "string" ? parsed.lastRunAt : undefined
        };
      }
      return {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      logger.warn({ taskId, error }, "Failed to read cron task state");
      return {};
    }
  }

  private async writeState(taskId: string, state: CronTaskState): Promise<void> {
    const statePath = this.getStatePath(taskId);
    try {
      await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    } catch (error) {
      logger.warn({ taskId, error }, "Failed to write cron task state");
    }
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type Frontmatter = Record<string, string | number | boolean>;

type ParsedDocument = {
  frontmatter: Frontmatter;
  body: string;
};

/**
 * Parse YAML frontmatter from markdown content.
 * Supports simple key: value pairs only.
 */
function parseFrontmatter(content: string): ParsedDocument {
  const trimmed = content.trim();

  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: trimmed };
  }

  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: trimmed };
  }

  const frontmatterBlock = trimmed.slice(4, endIndex);
  const body = trimmed.slice(endIndex + 4).trim();

  const frontmatter: Frontmatter = {};
  const lines = frontmatterBlock.split("\n");

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const colonIndex = trimmedLine.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, colonIndex).trim();
    let value: string | number | boolean = trimmedLine.slice(colonIndex + 1).trim();

    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    } else if (!isNaN(Number(value)) && value.length > 0) {
      value = Number(value);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/**
 * Serialize frontmatter and body to markdown format.
 */
function serializeFrontmatter(frontmatter: Frontmatter, body: string): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value === "string") {
      // Quote strings that contain special characters
      if (value.includes(":") || value.includes("\n") || value.includes('"')) {
        lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(body);
  lines.push("");

  return lines.join("\n");
}

export { parseFrontmatter, serializeFrontmatter };
