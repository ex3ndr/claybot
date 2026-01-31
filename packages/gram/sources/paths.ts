import os from "node:os";
import path from "node:path";

function resolveScoutRoot(): string {
  const root = process.env.SCOUT_ROOT_DIR?.trim();
  if (root) {
    return path.resolve(root);
  }
  return path.join(os.homedir(), ".scout");
}

export const DEFAULT_SCOUT_DIR = resolveScoutRoot();

export function resolveScoutPath(...segments: string[]): string {
  return path.join(DEFAULT_SCOUT_DIR, ...segments);
}

export const DEFAULT_SOUL_PATH = resolveScoutPath("SOUL.md");
export const DEFAULT_USER_PATH = resolveScoutPath("USER.md");
