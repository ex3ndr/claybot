import { promises as fs } from "node:fs";
import path from "node:path";

import { createId } from "@paralleldrive/cuid2";

import type { StoredFile } from "./types.js";
import { sanitizeFilename } from "../util/filename.js";
import type { Config } from "@/types";

export class FileStore {
  private basePath: string;

  constructor(config: Config) {
    this.basePath = config.filesDir;
  }

  resolvePath(): string {
    return path.resolve(this.basePath);
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.resolvePath(), { recursive: true });
  }

  async saveBuffer(options: {
    name: string;
    mimeType: string;
    data: Buffer;
    source: string;
  }): Promise<StoredFile> {
    await this.ensureDir();
    const id = createId();
    const filename = `${id}__${sanitizeFilename(options.name)}`;
    const filePath = path.join(this.resolvePath(), filename);
    await fs.writeFile(filePath, options.data);
    const stats = await fs.stat(filePath);
    const record: StoredFile = {
      id,
      name: options.name,
      path: filePath,
      mimeType: options.mimeType,
      size: stats.size,
      source: options.source,
      createdAt: new Date().toISOString()
    };
    await this.writeMetadata(record);
    return record;
  }

  async saveFromPath(options: {
    name: string;
    mimeType: string;
    source: string;
    path: string;
  }): Promise<StoredFile> {
    await this.ensureDir();
    const id = createId();
    const filename = `${id}__${sanitizeFilename(options.name)}`;
    const filePath = path.join(this.resolvePath(), filename);
    await fs.copyFile(options.path, filePath);
    const stats = await fs.stat(filePath);
    const record: StoredFile = {
      id,
      name: options.name,
      path: filePath,
      mimeType: options.mimeType,
      size: stats.size,
      source: options.source,
      createdAt: new Date().toISOString()
    };
    await this.writeMetadata(record);
    return record;
  }

  async get(id: string): Promise<StoredFile | null> {
    try {
      const content = await fs.readFile(this.metadataPath(id), "utf8");
      return JSON.parse(content) as StoredFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private metadataPath(id: string): string {
    return path.join(this.resolvePath(), `${id}.json`);
  }

  private async writeMetadata(record: StoredFile): Promise<void> {
    const payload = `${JSON.stringify(record, null, 2)}\n`;
    await fs.writeFile(this.metadataPath(record.id), payload, "utf8");
  }
}
