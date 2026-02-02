import { promises as fs } from "node:fs";
import path from "node:path";

import type { AssistantSettings } from "../settings.js";

export type SessionPermissions = {
  workingDir: string;
  writeDirs: string[];
  readDirs: string[];
  web: boolean;
};

export function resolveWorkspaceDir(
  configDir: string,
  assistant?: AssistantSettings | null
): string {
  const configured = assistant?.workspaceDir?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? path.resolve(configured)
      : path.resolve(configDir, configured);
  }
  return path.resolve(configDir, "workspace");
}

export async function ensureWorkspaceDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function normalizePermissions(
  value: unknown,
  defaultWorkingDir: string
): SessionPermissions {
  let writeDirs: string[] = [];
  let readDirs: string[] = [];
  let web = false;
  if (value && typeof value === "object") {
    const candidate = value as {
      workingDir?: unknown;
      writeDirs?: unknown;
      readDirs?: unknown;
      web?: unknown;
    };
    if (typeof candidate.workingDir === "string" && candidate.workingDir.trim().length > 0) {
      if (path.isAbsolute(candidate.workingDir)) {
        if (Array.isArray(candidate.writeDirs)) {
          writeDirs = candidate.writeDirs
            .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
            .map((entry) => entry.trim())
            .filter((entry) => path.isAbsolute(entry))
            .map((entry) => path.resolve(entry));
        }
        if (Array.isArray(candidate.readDirs)) {
          readDirs = candidate.readDirs
            .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
            .map((entry) => entry.trim())
            .filter((entry) => path.isAbsolute(entry))
            .map((entry) => path.resolve(entry));
        }
        if (typeof candidate.web === "boolean") {
          web = candidate.web;
        }
        return {
          workingDir: path.resolve(candidate.workingDir),
          writeDirs: dedupe(writeDirs),
          readDirs: dedupe(readDirs),
          web
        };
      }
    }
  }
  return {
    workingDir: path.resolve(defaultWorkingDir),
    writeDirs: [],
    readDirs: [],
    web: false
  };
}

export function resolveWorkspacePath(workingDir: string, target: string): string {
  const resolved = path.resolve(workingDir, target);
  const relative = path.relative(workingDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside the workspace.");
  }
  return resolved;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
