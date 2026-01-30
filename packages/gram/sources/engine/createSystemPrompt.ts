import { promises as fs } from "node:fs";
import path from "node:path";

import { DEFAULT_SOUL_PATH } from "../paths.js";

export async function createSystemPrompt(): Promise<string> {
  const resolvedPath = path.resolve(DEFAULT_SOUL_PATH);
  try {
    const content = await fs.readFile(resolvedPath, "utf8");
    const trimmed = content.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  // File missing or empty - create from bundled default
  const defaultContent = await readDefaultSoulPrompt();
  const dir = path.dirname(resolvedPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(resolvedPath, defaultContent, "utf8");
  return defaultContent.trim();
}

async function readDefaultSoulPrompt(): Promise<string> {
  const promptsDir = new URL("../prompts/SOUL.md", import.meta.url);
  return fs.readFile(promptsDir, "utf8");
}
