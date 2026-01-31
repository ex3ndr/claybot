import { promises as fs } from "node:fs";
import path from "node:path";

import { getLogger } from "../../log.js";

const logger = getLogger("memory.store");
const INDEX_FILENAME = "INDEX.md";
const ENTITY_PATTERN = /^[a-z]+$/;

export type MemoryEntityResult = {
  entity: string;
  created: boolean;
  path: string;
};

export type MemoryRecordResult = {
  entity: string;
  record: string;
  created: boolean;
  path: string;
};

export class MemoryStore {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = path.resolve(basePath);
  }

  async ensure(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
    const indexPath = this.indexPath();
    try {
      await fs.access(indexPath);
    } catch {
      await fs.writeFile(indexPath, "# Memory Index\n", "utf8");
    }
  }

  async createEntity(entityInput: string): Promise<MemoryEntityResult> {
    const entity = validateEntity(entityInput);
    await this.ensure();

    const entityPath = this.entityPath(entity);
    const exists = await fileExists(entityPath);
    if (!exists) {
      await fs.writeFile(entityPath, `# ${entity}\n`, "utf8");
    }

    const entities = await this.listEntities();
    if (!entities.includes(entity)) {
      entities.push(entity);
      entities.sort();
      await this.writeIndex(entities);
    }

    logger.info({ entity, created: !exists }, "Memory entity ready");

    return { entity, created: !exists, path: entityPath };
  }

  async upsertRecord(
    entityInput: string,
    recordInput: string,
    contentInput: string
  ): Promise<MemoryRecordResult> {
    const entity = validateEntity(entityInput);
    const record = validateRecord(recordInput);
    const content = normalizeContent(contentInput);

    await this.ensure();

    const entities = await this.listEntities();
    if (!entities.includes(entity)) {
      throw new Error(`Unknown entity: ${entity}. Create it first.`);
    }

    const entityPath = this.entityPath(entity);
    const exists = await fileExists(entityPath);
    if (!exists) {
      throw new Error(`Entity file missing for ${entity}. Create it first.`);
    }

    const raw = await fs.readFile(entityPath, "utf8");
    const parsed = parseRecords(raw, entity);
    const match = parsed.records.find((entry) => entry.key === record);
    const created = !match;

    if (match) {
      match.body = content;
    } else {
      parsed.records.push({ key: record, body: content });
    }

    const updated = serializeRecords(parsed.prefix, parsed.records, entity);
    await fs.writeFile(entityPath, updated, "utf8");

    logger.info({ entity, record, created }, "Memory record upserted");

    return { entity, record, created, path: entityPath };
  }

  private indexPath(): string {
    return path.join(this.basePath, INDEX_FILENAME);
  }

  private entityPath(entity: string): string {
    return path.join(this.basePath, `${entity}.md`);
  }

  private async listEntities(): Promise<string[]> {
    await this.ensure();
    const indexPath = this.indexPath();
    const raw = await fs.readFile(indexPath, "utf8");
    const lines = raw.split(/\r?\n/);
    const entities: string[] = [];
    for (const line of lines) {
      const match = line.match(/^\s*-\s*([a-z]+)\s*$/);
      if (match) {
        const entity = match[1];
        if (entity) {
          entities.push(entity);
        }
      }
    }
    return Array.from(new Set(entities));
  }

  private async writeIndex(entities: string[]): Promise<void> {
    const lines = ["# Memory Index", "", ...entities.map((entity) => `- ${entity}`), ""];
    await fs.writeFile(this.indexPath(), lines.join("\n"), "utf8");
  }
}

type ParsedRecords = {
  prefix: string;
  records: Array<{ key: string; body: string }>;
};

function parseRecords(markdown: string, entity: string): ParsedRecords {
  const normalized = markdown ?? "";
  const headerRegex = /^##\s+(.+)$/gm;
  const matches = Array.from(normalized.matchAll(headerRegex));

  if (matches.length === 0) {
    const prefix = normalized.trim().length > 0 ? normalized.trimEnd() : `# ${entity}`;
    return { prefix, records: [] };
  }

  const firstMatch = matches[0];
  if (!firstMatch) {
    const prefix = normalized.trim().length > 0 ? normalized.trimEnd() : `# ${entity}`;
    return { prefix, records: [] };
  }
  const prefix = normalized.slice(0, firstMatch.index ?? 0).trimEnd();
  const records = matches.map((match, index) => {
    const start = match.index ?? 0;
    const header = match[1]?.trim() ?? "";
    const contentStart = start + match[0].length;
    const nextStart = matches[index + 1]?.index ?? normalized.length;
    let body = normalized.slice(contentStart, nextStart);
    body = body.replace(/^\s*\n/, "").replace(/\s*$/, "");
    return { key: header, body };
  });

  return { prefix, records };
}

function serializeRecords(
  prefix: string,
  records: Array<{ key: string; body: string }>,
  entity: string
): string {
  const cleanedPrefix = prefix.trim().length > 0 ? prefix.trimEnd() : `# ${entity}`;
  const sections = records.map((record) => {
    const body = record.body.trim();
    return body.length > 0
      ? `## ${record.key}\n${body}`
      : `## ${record.key}`;
  });

  const content = [cleanedPrefix, ...sections].join("\n\n");
  return `${content.trimEnd()}\n`;
}

function validateEntity(value: string): string {
  const trimmed = value.trim();
  if (!ENTITY_PATTERN.test(trimmed)) {
    throw new Error("Entity must be a lowercase english word (a-z only, no underscores).");
  }
  return trimmed;
}

function validateRecord(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Record name is required.");
  }
  if (/\r|\n/.test(trimmed)) {
    throw new Error("Record name must be a single line.");
  }
  return trimmed;
}

function normalizeContent(value: string): string {
  return value.trim();
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
