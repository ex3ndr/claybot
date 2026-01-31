import { promises as fs } from "node:fs";
import path from "node:path";

import { getLogger } from "../log.js";
import { parseFrontmatter } from "./cron-store.js";

const logger = getLogger("heartbeat.store");

export type HeartbeatDefinition = {
  id: string;
  title: string;
  prompt: string;
  filePath: string;
};

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

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
        continue;
      }
      const filePath = path.join(this.basePath, entry.name);
      const task = await this.loadTask(filePath);
      if (task) {
        tasks.push(task);
      }
    }

    return tasks;
  }

  async loadTask(filePath: string): Promise<HeartbeatDefinition | null> {
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

      return {
        id,
        title,
        prompt,
        filePath
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      logger.warn({ filePath, error }, "Failed to load heartbeat file");
      return null;
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
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
