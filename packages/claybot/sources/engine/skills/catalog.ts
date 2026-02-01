import path from "node:path";
import { constants as fsConstants, promises as fs } from "node:fs";

import { getLogger } from "../../log.js";

export type SkillRoot =
  | { type: "core"; root: string }
  | { type: "plugin"; pluginId: string; root: string };

export type AgentSkill = {
  id: string;
  name: string;
  path: string;
  source: "core" | "plugin";
  pluginId?: string;
};

const logger = getLogger("engine.skills");
const SKILL_EXTENSIONS = new Set([".md"]);

export async function listAgentSkills(roots: SkillRoot[]): Promise<AgentSkill[]> {
  const skills: AgentSkill[] = [];

  for (const root of roots) {
    const files = await collectSkillFiles(root.root);
    for (const file of files) {
      const readable = await isReadable(file);
      if (!readable) {
        logger.warn({ path: file }, "Skill file not readable; skipping");
        continue;
      }
      const resolvedPath = path.resolve(file);
      const id = buildSkillId(root, resolvedPath);
      const name = formatSkillName(resolvedPath);
      const entry: AgentSkill = {
        id,
        name,
        path: resolvedPath,
        source: root.type,
        pluginId: root.type === "plugin" ? root.pluginId : undefined
      };
      skills.push(entry);
    }
  }

  return skills.sort((a, b) => {
    const nameSort = a.name.localeCompare(b.name);
    if (nameSort !== 0) {
      return nameSort;
    }
    return a.path.localeCompare(b.path);
  });
}

export function formatSkillsPrompt(skills: AgentSkill[]): string {
  if (skills.length === 0) {
    return "";
  }

  const lines = [
    "## Skills",
    "Skills live on disk and are not loaded automatically.",
    "Load a skill by reading its file. Reload by reading the file again. Unload by explicitly ignoring its guidance.",
    "",
    "Available skills:"
  ];

  for (const skill of skills) {
    const source =
      skill.source === "plugin" ? `plugin:${skill.pluginId ?? "unknown"}` : "core";
    lines.push(`- ${skill.name} (${source}) -> ${skill.path}`);
  }

  return lines.join("\n");
}

async function collectSkillFiles(root: string): Promise<string[]> {
  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    if (code === "ENOTDIR") {
      logger.warn({ path: root }, "Skill root is not a directory; skipping");
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
    const ext = path.extname(entry.name).toLowerCase();
    if (SKILL_EXTENSIONS.has(ext)) {
      results.push(fullPath);
    }
  }

  return results;
}

async function isReadable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.R_OK);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return false;
    }
    if (code === "EACCES") {
      return false;
    }
    throw error;
  }
}

function buildSkillId(root: SkillRoot, filePath: string): string {
  const ext = path.extname(filePath);
  const relative = path.relative(root.root, filePath);
  const withoutExt = ext.length > 0 ? relative.slice(0, -ext.length) : relative;
  const slug = withoutExt.split(path.sep).join("/");
  if (root.type === "plugin") {
    return `plugin:${root.pluginId}/${slug}`;
  }
  return `core:${slug}`;
}

function formatSkillName(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  return base.replace(/[-_]+/g, " ").trim();
}
