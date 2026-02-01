import path from "node:path";
import { constants as fsConstants, promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

import { getLogger } from "../../log.js";

export type AgentSkill = {
  id: string;
  name: string;
  path: string;
  source: "core" | "plugin";
  pluginId?: string;
};

export type PluginSkillRegistration = {
  pluginId: string;
  path: string;
};

type SkillSource =
  | { source: "core"; root?: string }
  | { source: "plugin"; pluginId: string };

const logger = getLogger("engine.skills");
const SKILL_FILENAME = "skill.md";
const CORE_SKILLS_ROOT = fileURLToPath(new URL("../../skills", import.meta.url));

export async function listCoreSkills(): Promise<AgentSkill[]> {
  return listSkillsFromRoot(CORE_SKILLS_ROOT, { source: "core", root: CORE_SKILLS_ROOT });
}

export async function listRegisteredSkills(
  registrations: PluginSkillRegistration[]
): Promise<AgentSkill[]> {
  const skills: AgentSkill[] = [];
  const seen = new Set<string>();

  for (const registration of registrations) {
    const resolvedPath = path.resolve(registration.path);
    const key = `${registration.pluginId}:${resolvedPath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const skill = await resolveSkill(resolvedPath, {
      source: "plugin",
      pluginId: registration.pluginId
    });
    if (skill) {
      skills.push(skill);
    }
  }

  return sortSkills(skills);
}

export function formatSkillsPrompt(skills: AgentSkill[]): string {
  const unique = new Map<string, AgentSkill>();
  for (const skill of skills) {
    if (!unique.has(skill.path)) {
      unique.set(skill.path, skill);
    }
  }
  const ordered = sortSkills(Array.from(unique.values()));

  if (ordered.length === 0) {
    return "";
  }

  const lines = [
    "## Skills",
    "Skills live on disk and are not loaded automatically.",
    "Load a skill by reading its file. Reload by reading the file again. Unload by explicitly ignoring its guidance.",
    "",
    "Available skills:"
  ];

  for (const skill of ordered) {
    const sourceLabel =
      skill.source === "plugin" ? `plugin:${skill.pluginId ?? "unknown"}` : "core";
    lines.push(`- ${skill.name} (${sourceLabel}) -> ${skill.path}`);
  }

  return lines.join("\n");
}

export async function listSkillsFromRoot(
  root: string,
  source: SkillSource
): Promise<AgentSkill[]> {
  const files = await collectSkillFiles(root);
  const skills: AgentSkill[] = [];
  for (const file of files) {
    const skill = await resolveSkill(file, source, root);
    if (skill) {
      skills.push(skill);
    }
  }
  return sortSkills(skills);
}

async function collectSkillFiles(root: string): Promise<string[]> {
  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      logger.warn({ path: root }, "Skills root missing; skipping");
      return [];
    }
    if (code === "ENOTDIR") {
      logger.warn({ path: root }, "Skills root is not a directory; skipping");
      return [];
    }
    throw error;
  }

  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectSkillFiles(fullPath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name.toLowerCase() === SKILL_FILENAME) {
      results.push(fullPath);
    }
  }

  return results;
}

async function resolveSkill(
  filePath: string,
  source: SkillSource,
  root?: string
): Promise<AgentSkill | null> {
  const resolvedPath = path.resolve(filePath);
  const readable = await isReadableFile(resolvedPath);
  if (!readable) {
    logger.warn({ path: resolvedPath }, "Skill file not readable; skipping");
    return null;
  }

  const name = formatSkillName(resolvedPath);
  const id = buildSkillId(resolvedPath, source, root);

  return {
    id,
    name,
    path: resolvedPath,
    source: source.source,
    pluginId: source.source === "plugin" ? source.pluginId : undefined
  };
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return false;
    }
    await fs.access(filePath, fsConstants.R_OK);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES") {
      return false;
    }
    throw error;
  }
}

function buildSkillId(filePath: string, source: SkillSource, root?: string): string {
  const fileName = path.basename(filePath).toLowerCase();
  let slug = "";

  if (fileName === SKILL_FILENAME) {
    if (root) {
      slug = path.relative(root, path.dirname(filePath));
    } else {
      slug = path.basename(path.dirname(filePath));
    }
  } else {
    slug = path.basename(filePath, path.extname(filePath));
  }

  const normalized = slug.length > 0 ? slug.split(path.sep).join("/") : "skill";
  if (source.source === "plugin") {
    return `plugin:${source.pluginId}/${normalized}`;
  }
  return `core:${normalized}`;
}

function formatSkillName(filePath: string): string {
  const fileName = path.basename(filePath).toLowerCase();
  if (fileName === SKILL_FILENAME) {
    return normalizeName(path.basename(path.dirname(filePath)));
  }
  return normalizeName(path.basename(filePath, path.extname(filePath)));
}

function normalizeName(value: string): string {
  return value.replace(/[-_]+/g, " ").trim();
}

function sortSkills(skills: AgentSkill[]): AgentSkill[] {
  return skills.sort((a, b) => {
    const nameSort = a.name.localeCompare(b.name);
    if (nameSort !== 0) {
      return nameSort;
    }
    return a.path.localeCompare(b.path);
  });
}
