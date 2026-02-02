import path from "node:path";

import type { PermissionAccess, SessionPermissions } from "@/types";
import { pathSanitizeAndResolve } from "./pathSanitize.js";

/**
 * Applies a permission access to a permissions object in place.
 * Returns true when applied; false when invalid or unsupported.
 */
export function permissionAccessApply(
  permissions: SessionPermissions,
  access: PermissionAccess
): boolean {
  if (access.kind === "web") {
    permissions.web = true;
    return true;
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

  if (access.kind === "write") {
    const next = new Set(permissions.writeDirs);
    next.add(resolved);
    permissions.writeDirs = Array.from(next.values());
    return true;
  }

  if (access.kind === "read") {
    const next = new Set(permissions.readDirs);
    next.add(resolved);
    permissions.readDirs = Array.from(next.values());
    return true;
  }

  return false;
}
