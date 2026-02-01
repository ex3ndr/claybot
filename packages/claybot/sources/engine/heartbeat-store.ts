import { promises as fs } from "node:fs";
import path from "node:path";

import { getLogger } from "../log.js";
import { cronFrontmatterParse as parseFrontmatter } from "./cron/cronFrontmatterParse.js";
import { cronFrontmatterSerialize as serializeFrontmatter } from "./cron/cronFrontmatterSerialize.js";

const logger = getLogger("heartbeat.store");

export type HeartbeatDefinition = {
  id: string;
  title: string;
  prompt: string;
  filePath: string;
  lastRunAt?: string;
};

type HeartbeatState = { lastRunAt?: string };

export class HeartbeatStore {
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

  async createTask(definition: {
    id?: string;
    title: string;
    prompt: string;
    overwrite?: boolean;
  }): Promise<HeartbeatDefinition> {
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
    if (providedId && !isSafeTaskId(providedId)) {
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

    const frontmatter = { title };
    const content = serializeFrontmatter(frontmatter, prompt);
    await fs.writeFile(filePath, content, "utf8");

    return {
      id,
      title,
      prompt,
      filePath,
      lastRunAt: undefined
    };
  }

  async deleteTask(taskId: string): Promise<boolean> {
    if (!isSafeTaskId(taskId)) {
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
      const parsed = parseFrontmatter(content);
      const baseName = path.basename(filePath, path.extname(filePath));
      const id = slugify(baseName) || baseName;

      const { title, prompt } = parseHeartbeat(parsed.body, parsed.frontmatter, baseName);
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
    const base = slugify(title) || "heartbeat";
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

function parseHeartbeat(
  body: string,
  frontmatter: Record<string, unknown>,
  fallbackTitle: string
): { title: string; prompt: string } {
  const trimmedBody = body.trim();
  const frontmatterTitle = frontmatter.title ?? frontmatter.name;
  if (frontmatterTitle && typeof frontmatterTitle === "string") {
    return {
      title: frontmatterTitle.trim() || fallbackTitle,
      prompt: trimmedBody
    };
  }

  if (trimmedBody.length > 0) {
    const lines = trimmedBody.split(/\r?\n/);
    const firstLine = lines[0]?.trim() ?? "";
    const headingMatch = /^#{1,6}\s+(.*)$/.exec(firstLine);
    if (headingMatch && headingMatch[1]) {
      const title = headingMatch[1].trim() || fallbackTitle;
      const prompt = lines.slice(1).join("\n").trim();
      return { title, prompt };
    }
  }

  return {
    title: fallbackTitle,
    prompt: trimmedBody
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-");
}

function isSafeTaskId(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value);
}
