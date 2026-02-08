import type { SessionPermissions } from "@/types";

/**
 * Builds a read-only scoped permission object from an agent permission set.
 * Expects: currentPermissions is normalized and absolute-path based.
 */
export function permissionScopeBuildReadOnly(
  currentPermissions: SessionPermissions
): SessionPermissions {
  const readDirs = currentPermissions.readDirs.length > 0
    ? Array.from(
        new Set([...currentPermissions.readDirs, ...currentPermissions.writeDirs])
      )
    : [];
  return {
    workingDir: currentPermissions.workingDir,
    writeDirs: [],
    readDirs,
    network: false
  };
}
