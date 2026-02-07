import { promises as fs } from "node:fs";
import path from "node:path";

import {
  DEFAULT_ACTORS_PATH,
  DEFAULT_MEMORY_PATH,
  DEFAULT_SOUL_PATH,
  DEFAULT_TOOLS_PATH,
  DEFAULT_USER_PATH
} from "../../../paths.js";
import { agentPromptBundledRead } from "./agentPromptBundledRead.js";

/**
 * Ensures the default prompt files (SOUL, USER, ACTORS, TOOLS, MEMORY) exist on disk.
 * Expects: caller wants bundled defaults written when missing.
 */
export async function agentPromptFilesEnsure(): Promise<void> {
  await promptFileEnsure(DEFAULT_SOUL_PATH, "SOUL.md");
  await promptFileEnsure(DEFAULT_USER_PATH, "USER.md");
  await promptFileEnsure(DEFAULT_ACTORS_PATH, "ACTORS.md");
  await promptFileEnsure(DEFAULT_TOOLS_PATH, "TOOLS.md");
  await promptFileEnsure(DEFAULT_MEMORY_PATH, "MEMORY.md");
}

async function promptFileEnsure(filePath: string, bundledName: string): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  try {
    await fs.access(resolvedPath);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const content = await agentPromptBundledRead(bundledName);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, content, "utf8");
}
