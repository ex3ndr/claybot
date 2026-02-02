import { promises as fs } from "node:fs";
import path from "node:path";

import { getLogger } from "../../../log.js";
import { stringSlugify } from "../../../utils/stringSlugify.js";
import { taskIdIsSafe } from "../../../utils/taskIdIsSafe.js";
import { cronFrontmatterParse } from "../../cron/ops/cronFrontmatterParse.js";
import { cronFrontmatterSerialize } from "../../cron/ops/cronFrontmatterSerialize.js";
import { heartbeatParse } from "./heartbeatParse.js";
import type {
  HeartbeatDefinition,
  HeartbeatState,
  HeartbeatCreateTaskArgs,
  HeartbeatStoreInterface
} from "../heartbeatTypes.js";
import { execGateNormalize } from "../../scheduling/execGateNormalize.js";

const logger = getLogger("heartbeat.store");

/**
 * Manages heartbeat tasks stored as markdown files.
 *
 * Structure:
 * - /heartbeat/<task-id>.md - frontmatter (title) + prompt body
 * - /heartbeat/.heartbeat-state.json - shared state (lastRunAt)
 */
export class HeartbeatStore implements HeartbeatStoreInterface {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  async listTasks(): Promise<HeartbeatDefinition[]> {
    await this.ensureDir();

    const entries = await fs.readdir(this.basePath, { withFileTypes: true });
    const tasks: HeartbeatDefinition[] = [];
    const state = await this.readState();

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
        continue;
      }
      const filePath = path.join(this.basePath, entry.name);
      const task = await this.loadTask(filePath, state);
      if (task) {
        tasks.push(task);
      }
    }

    return tasks;
  }

  async createTask(definition: HeartbeatCreateTaskArgs): Promise<HeartbeatDefinition> {
    await this.ensureDir();
    const title = definition.title.trim();
    const prompt = definition.prompt.trim();
    if (!title) {
      throw new Error("Heartbeat title is required.");
    }
    if (!prompt) {
      throw new Error("Heartbeat prompt is required.");
    }
    const providedId = definition.id?.trim();
    if (providedId && !taskIdIsSafe(providedId)) {
      throw new Error("Heartbeat id contains invalid characters.");
    }
    const id = providedId ?? await this.generateTaskIdFromTitle(title);
    const filePath = this.getTaskPath(id);

    if (!definition.overwrite) {
      const available = await this.isTaskIdAvailable(id);
      if (!available) {
        throw new Error(`Heartbeat already exists: ${id}`);
      }
    }

    const gate = execGateNormalize(definition.gate);
    const frontmatter: Record<string, unknown> = { title };
    if (gate) {
      frontmatter.gate = gate;
    }
    const content = cronFrontmatterSerialize(frontmatter, prompt);
    await fs.writeFile(filePath, content, "utf8");

    return {
      id,
      title,
      prompt,
      filePath,
      gate,
      lastRunAt: undefined
    };
  }

  async deleteTask(taskId: string): Promise<boolean> {
    if (!taskIdIsSafe(taskId)) {
      throw new Error("Heartbeat id contains invalid characters.");
    }
    const filePath = this.getTaskPath(taskId);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }

    return true;
  }

  async loadTask(filePath: string, state?: HeartbeatState): Promise<HeartbeatDefinition | null> {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const parsed = cronFrontmatterParse(content);
      const baseName = path.basename(filePath, path.extname(filePath));
      const id = stringSlugify(baseName) || baseName;

      const { title, prompt } = heartbeatParse(parsed.body, parsed.frontmatter, baseName);
      if (!prompt) {
        logger.warn({ filePath }, "Heartbeat file missing prompt");
        return null;
      }

      const lastRunAt = state?.lastRunAt;
      return {
        id,
        title,
        prompt,
        filePath,
        gate: execGateNormalize(parsed.frontmatter.gate),
        lastRunAt: typeof lastRunAt === "string" ? lastRunAt : undefined
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      logger.warn({ filePath, error }, "Failed to load heartbeat file");
      return null;
    }
  }

  async recordRun(runAt: Date): Promise<void> {
    await this.writeState({ lastRunAt: runAt.toISOString() });
  }

  private getStatePath(): string {
    return path.join(this.basePath, ".heartbeat-state.json");
  }

  private getTaskPath(taskId: string): string {
    return path.join(this.basePath, `${taskId}.md`);
  }

  private async generateTaskIdFromTitle(title: string): Promise<string> {
    const base = stringSlugify(title) || "heartbeat";
    let candidate = base;
    let suffix = 2;
    while (!(await this.isTaskIdAvailable(candidate))) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private async isTaskIdAvailable(taskId: string): Promise<boolean> {
    const filePath = this.getTaskPath(taskId);
    try {
      const stat = await fs.stat(filePath);
      return !stat.isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return true;
      }
      throw error;
    }
  }

  private async readState(): Promise<HeartbeatState> {
    const statePath = this.getStatePath();
    try {
      const raw = await fs.readFile(statePath, "utf8");
      const parsed = JSON.parse(raw) as HeartbeatState;
      if (!parsed || typeof parsed !== "object") {
        return {};
      }
      return { lastRunAt: typeof parsed.lastRunAt === "string" ? parsed.lastRunAt : undefined };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      logger.warn({ error }, "Failed to read heartbeat state");
      return {};
    }
  }

  private async writeState(state: HeartbeatState): Promise<void> {
    await this.ensureDir();
    const statePath = this.getStatePath();
    try {
      await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    } catch (error) {
      logger.warn({ error }, "Failed to write heartbeat state");
    }
  }
}
