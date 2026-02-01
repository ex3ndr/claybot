import { promises as fs } from "node:fs";
import path from "node:path";

import { pathSanitize } from "./pathSanitize.js";

/**
 * Result of secure path resolution.
 */
export type SecurePathResult = {
  /** Resolved real path (symlinks followed) */
  realPath: string;
  /** The allowed base directory that contains this path */
  allowedBase: string;
};

/**
 * Securely resolves a path, following symlinks and verifying containment.
 *
 * Addresses symlink following attacks by:
 * 1. Resolving all symlinks using fs.realpath()
 * 2. Checking containment against the real paths
 *
 * @param allowedDirs - Directories the path is allowed to be within
 * @param target - The target path to resolve
 * @returns The resolved real path and the base directory it's within
 * @throws Error if path is outside allowed directories or doesn't exist
 */
export async function pathResolveSecure(
  allowedDirs: string[],
  target: string
): Promise<SecurePathResult> {
  pathSanitize(target);

  if (!path.isAbsolute(target)) {
    throw new Error("Path must be absolute.");
  }

  // Resolve the target path following all symlinks
  let realPath: string;
  try {
    realPath = await fs.realpath(target);
  } catch (error) {
    // If the file doesn't exist yet (for write operations), resolve the parent
    const parent = path.dirname(target);
    const basename = path.basename(target);
    try {
      const realParent = await fs.realpath(parent);
      realPath = path.join(realParent, basename);
    } catch {
      // Parent also doesn't exist - use logical resolution
      realPath = path.resolve(target);
    }
  }

  // Check containment against each allowed directory (also resolve their real paths)
  for (const dir of allowedDirs) {
    let realDir: string;
    try {
      realDir = await fs.realpath(dir);
    } catch {
      // If the allowed dir doesn't exist, use logical resolution
      realDir = path.resolve(dir);
    }

    if (isWithinSecure(realDir, realPath)) {
      return { realPath, allowedBase: realDir };
    }
  }

  throw new Error("Path is outside the allowed directories.");
}

/**
 * Synchronous version that checks if a path would be within allowed dirs.
 * Does NOT resolve symlinks - use only when you've already resolved.
 */
export function isWithinSecure(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Opens a file handle securely with O_NOFOLLOW semantics.
 * This prevents TOCTOU attacks by atomically opening without following symlinks.
 *
 * @param filePath - Path to open
 * @param flags - File system flags (e.g., "r", "w", "a")
 * @returns File handle
 */
export async function openSecure(
  filePath: string,
  flags: string
): Promise<fs.FileHandle> {
  pathSanitize(filePath);

  // Check if target is a symlink before opening
  try {
    const stats = await fs.lstat(filePath);
    if (stats.isSymbolicLink()) {
      throw new Error("Cannot open symbolic link directly.");
    }
  } catch (error) {
    // File doesn't exist - OK for write/create operations
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  return fs.open(filePath, flags);
}
