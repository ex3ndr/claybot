import type { SessionPermissions } from "../permissions.js";

/**
 * Clones permissions so callers can mutate without affecting defaults.
 * Expects: permissions.writeDirs/readDirs are treated as mutable arrays.
 */
export function permissionClone(permissions: SessionPermissions): SessionPermissions {
  return {
    ...permissions,
    writeDirs: [...permissions.writeDirs],
    readDirs: [...permissions.readDirs]
  };
}
