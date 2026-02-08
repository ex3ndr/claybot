import path from "node:path";

import type { PermissionAccess, SessionPermissions } from "@/types";
import { pathResolveSecure } from "./pathResolveSecure.js";
import { pathSanitizeAndResolve } from "./pathSanitize.js";

/**
 * Checks whether a permission access is already allowed by current permissions.
 * Expects: access.kind is network/read/write; paths must be absolute.
 */
export async function permissionAccessAllows(
  permissions: SessionPermissions,
  access: PermissionAccess
): Promise<boolean> {
  if (access.kind === "network") {
    return permissions.network;
  }

  if (!path.isAbsolute(access.path)) {
    return false;
  }

  let resolved: string;
  try {
    resolved = pathSanitizeAndResolve(access.path);
  } catch {
    return false;
  }

  const allowedDirs = access.kind === "write"
    ? [...permissions.writeDirs]
    : permissions.readDirs.length > 0
      ? [permissions.workingDir, ...permissions.readDirs, ...permissions.writeDirs]
      : [path.parse(resolved).root];

  try {
    await pathResolveSecure(allowedDirs, resolved);
    return true;
  } catch {
    return false;
  }
}
