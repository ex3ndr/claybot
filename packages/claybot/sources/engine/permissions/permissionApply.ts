import path from "node:path";

import type { PermissionDecision } from "@/types";
import type { SessionPermissions } from "../permissions.js";
import { pathSanitizeAndResolve } from "./pathSanitize.js";

export function permissionApply(
  permissions: SessionPermissions,
  decision: PermissionDecision
): void {
  if (!decision.approved) {
    return;
  }
  if (decision.access.kind === "web") {
    permissions.web = true;
    return;
  }
  if (!path.isAbsolute(decision.access.path)) {
    return;
  }

  // Sanitize path before adding to permissions
  // Throws on null bytes, control characters, or excessive length
  let resolved: string;
  try {
    resolved = pathSanitizeAndResolve(decision.access.path);
  } catch {
    // Silently reject invalid paths
    return;
  }

  if (decision.access.kind === "write") {
    const next = new Set(permissions.writeDirs);
    next.add(resolved);
    permissions.writeDirs = Array.from(next.values());
    return;
  }
  if (decision.access.kind === "read") {
    const next = new Set(permissions.readDirs);
    next.add(resolved);
    permissions.readDirs = Array.from(next.values());
  }
}
