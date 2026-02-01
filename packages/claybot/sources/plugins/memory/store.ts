import { promises as fs } from "node:fs";
import path from "node:path";

import { getLogger } from "../../log.js";

const logger = getLogger("plugin.memory");
const INDEX_FILENAME = "INDEX.md";
const ENTITY_PATTERN = /^[a-z]+$/;
const MAX_NAME_LENGTH = 60;
const MAX_DESC_LENGTH = 160;

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

export type MemoryEntitySummary = {
  entity: string;
  name: string;
  description: string;
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

  async createEntity(
    entityInput: string,
    nameInput: string,
    descriptionInput: string
  ): Promise<MemoryEntityResult> {
    const entity = validateEntity(entityInput);
    const name = validateShortText(nameInput, "Name", MAX_NAME_LENGTH);
    const description = validateShortText(descriptionInput, "Description", MAX_DESC_LENGTH);
    await this.ensure();

    const entityPath = this.entityPath(entity);
    const exists = await fileExists(entityPath);

    let body = `# ${entity}`;
    if (exists) {
      const raw = await fs.readFile(entityPath, "utf8");
      const parsed = parseEntityFile(raw);
      body = parsed.body.trim().length > 0 ? parsed.body.trimEnd() : body;
    }

    const frontmatter: MemoryFrontmatter = { name, description };
    const content = serializeEntity(frontmatter, body);
    await fs.writeFile(entityPath, content, "utf8");

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
    const parsedFile = parseEntityFile(raw);
    const frontmatter = normalizeFrontmatter(parsedFile.frontmatter);
    const parsedRecords = parseRecords(parsedFile.body, entity);
    const match = parsedRecords.records.find((entry) => entry.key === record);
    const created = !match;

    if (match) {
      match.body = content;
    } else {
      parsedRecords.records.push({ key: record, body: content });
    }

    const updated = serializeEntity(
      frontmatter,
      serializeRecords(parsedRecords.prefix, parsedRecords.records, entity)
    );
    await fs.writeFile(entityPath, updated, "utf8");

    logger.info({ entity, record, created }, "Memory record upserted");

    return { entity, record, created, path: entityPath };
  }

  async listEntitySummaries(limit?: number): Promise<MemoryEntitySummary[]> {
    await this.ensure();
    const entities = await this.listEntities();
    const summaries: MemoryEntitySummary[] = [];
    const max = limit ?? entities.length;

    for (const entity of entities) {
      if (summaries.length >= max) {
        break;
      }
      const entityPath = this.entityPath(entity);
      const raw = await fs.readFile(entityPath, "utf8");
      const parsedFile = parseEntityFile(raw);
      const frontmatter = normalizeFrontmatter(parsedFile.frontmatter);
      summaries.push({
        entity,
        name: frontmatter.name,
        description: frontmatter.description,
        path: entityPath
      });
    }

    return summaries;
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
        const entry = match[1];
        if (entry) {
          entities.push(entry);
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

type MemoryFrontmatter = {
  name?: string;
  description?: string;
};

type ParsedEntity = {
  frontmatter: MemoryFrontmatter;
  body: string;
};

function parseEntityFile(markdown: string): ParsedEntity {
  const content = markdown ?? "";
  const frontmatterMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!frontmatterMatch) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterBlock = frontmatterMatch[1] ?? "";
  const frontmatter = parseFrontmatter(frontmatterBlock);
  const body = content.slice(frontmatterMatch[0].length);
  return { frontmatter, body };
}

function parseFrontmatter(block: string): MemoryFrontmatter {
  const lines = block.split(/\r?\n/);
  const frontmatter: MemoryFrontmatter = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    value = value.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
    if (!value) {
      continue;
    }
    if (key === "name") {
      frontmatter.name = value;
    }
    if (key === "description") {
      frontmatter.description = value;
    }
  }
  return frontmatter;
}

function normalizeFrontmatter(frontmatter: MemoryFrontmatter): Required<MemoryFrontmatter> {
  const name = validateShortText(frontmatter.name ?? "", "Name", MAX_NAME_LENGTH);
  const description = validateShortText(frontmatter.description ?? "", "Description", MAX_DESC_LENGTH);
  return { name, description };
}

function serializeEntity(frontmatter: MemoryFrontmatter, body: string): string {
  const lines = [
    "---",
    `name: "${escapeYaml(frontmatter.name ?? "")}"`,
    `description: "${escapeYaml(frontmatter.description ?? "")}"`,
    "---",
    ""
  ];
  const trimmedBody = body.trim().length > 0 ? body.trimEnd() : "";
  const content = `${lines.join("\n")}${trimmedBody}\n`;
  return content;
}

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

function validateShortText(value: string, label: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  if (trimmed.length > max) {
    throw new Error(`${label} must be at most ${max} characters.`);
  }
  if (/\r|\n/.test(trimmed)) {
    throw new Error(`${label} must be a single line.`);
  }
  return trimmed;
}

function normalizeContent(value: string): string {
  return value.trim();
}

function escapeYaml(value: string): string {
  return value.replace(/"/g, "\\\"");
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
