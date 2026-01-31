import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_SOCKET_FILENAME = "scout.sock";
const DEFAULT_PROD_ROOT = path.join(os.homedir(), ".scout");
const DEFAULT_DEV_ROOT = path.join(os.homedir(), ".dev");

function resolveScoutRoot() {
  const override = process.env.SCOUT_ROOT_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  if (process.env.NODE_ENV === "development") {
    return DEFAULT_DEV_ROOT;
  }
  return DEFAULT_PROD_ROOT;
}

function resolveWorkspaceRoot(rootDir: string) {
  const parent = path.resolve(rootDir, "..");
  if (path.basename(parent) === "packages") {
    return path.resolve(parent, "..");
  }
  return rootDir;
}

async function pathExists(targetPath: string) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function resolveSocketPath() {
  const override = process.env.SCOUT_ENGINE_SOCKET;
  if (override) {
    return path.resolve(override);
  }

  const rootDir = process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(rootDir);
  const scoutRoot = resolveScoutRoot();
  const defaultSocketPath = path.join(scoutRoot, DEFAULT_SOCKET_FILENAME);
  const candidates = [
    defaultSocketPath,
    path.resolve(rootDir, ".scout", DEFAULT_SOCKET_FILENAME),
    path.resolve(workspaceRoot, ".scout", DEFAULT_SOCKET_FILENAME),
    path.resolve(workspaceRoot, "packages", "gram", ".scout", DEFAULT_SOCKET_FILENAME)
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}
