import type { SessionPermissions } from "../permissions.js";

export function permissionMergeDefault(
  permissions: SessionPermissions,
  defaultPermissions: SessionPermissions
): SessionPermissions {
  const nextWrite = new Set([...defaultPermissions.writeDirs, ...permissions.writeDirs]);
  const nextRead = new Set([...defaultPermissions.readDirs, ...permissions.readDirs]);
  return {
    // Use nullish coalescing to properly handle empty string
    workingDir: permissions.workingDir?.trim() || defaultPermissions.workingDir,
    writeDirs: Array.from(nextWrite.values()),
    readDirs: Array.from(nextRead.values()),
    web: permissions.web || defaultPermissions.web
  };
}
