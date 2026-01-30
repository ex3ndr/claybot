import { promises as fs } from "node:fs";
import path from "node:path";

import { createId } from "@paralleldrive/cuid2";

import type { FileReference } from "../../files/types.js";
import type { SessionStore } from "../sessions/store.js";
import type { SessionSummary } from "../sessions/types.js";

export type MemoryEntry = {
  id: string;
  sessionId: string;
  source: string;
  role: "user" | "assistant" | "tool" | "system";
  text: string | null;
  files?: FileReference[];
  createdAt: string;
};

export type MemoryEngineOptions = {
  basePath?: string;
  maxEntries?: number;
  sessionStore: SessionStore;
};

const DEFAULT_BASE_PATH = ".scout/memory";

export class MemoryEngine {
  private basePath: string;
  private sessionStore: SessionStore;
  private maxEntries?: number;

  constructor(options: MemoryEngineOptions) {
    this.basePath = options.basePath ?? DEFAULT_BASE_PATH;
    this.sessionStore = options.sessionStore;
    this.maxEntries = options.maxEntries;
  }

  async record(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<MemoryEntry> {
    const stored: MemoryEntry = {
      id: createId(),
      createdAt: new Date().toISOString(),
      ...entry
    };
    await this.ensureDir();
    await fs.appendFile(this.logPath(), `${JSON.stringify(stored)}\n`, "utf8");
    if (this.maxEntries) {
      await this.prune(this.maxEntries);
    }
    return stored;
  }

  async query(text: string, limit = 20): Promise<MemoryEntry[]> {
    const entries = await this.readEntries();
    const needle = text.trim().toLowerCase();
    if (!needle) {
      return entries.slice(-limit);
    }
    const matches = entries.filter((entry) =>
      (entry.text ?? "").toLowerCase().includes(needle)
    );
    return matches.slice(-limit);
  }

  async listSessions(): Promise<SessionSummary[]> {
    return this.sessionStore.listSessions();
  }

  async readSessionEntries(storageId: string) {
    return this.sessionStore.readSessionEntries(storageId);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  private logPath(): string {
    return path.join(this.basePath, "memory.jsonl");
  }

  private async readEntries(): Promise<MemoryEntry[]> {
    let raw = "";
    try {
      raw = await fs.readFile(this.logPath(), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as MemoryEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is MemoryEntry => Boolean(entry));
  }

  private async prune(maxEntries: number): Promise<void> {
    const entries = await this.readEntries();
    if (entries.length <= maxEntries) {
      return;
    }
    const trimmed = entries.slice(-maxEntries);
    await this.ensureDir();
    const payload = `${trimmed.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    await fs.writeFile(this.logPath(), payload, "utf8");
  }
}
