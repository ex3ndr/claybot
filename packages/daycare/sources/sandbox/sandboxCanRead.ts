import path from "node:path";

import type { SessionPermissions } from "@/types";
import { pathResolveSecure } from "../engine/permissions/pathResolveSecure.js";

/**
 * Resolves a read target against the current read allowlist.
 * Expects: target is an absolute path.
 */
export async function sandboxCanRead(
  permissions: SessionPermissions,
  target: string
): Promise<string> {
  // Tool-level reads are always allowed across the filesystem.
  const allowedDirs = [path.parse(target).root];
  const result = await pathResolveSecure(allowedDirs, target);
  return result.realPath;
}
