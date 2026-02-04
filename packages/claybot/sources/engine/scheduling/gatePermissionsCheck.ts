import type { PermissionAccess, SessionPermissions } from "@/types";
import { permissionAccessAllows } from "../permissions/permissionAccessAllows.js";

export type GatePermissionsCheckResult = {
  allowed: boolean;
  missing: string[];
};

/**
 * Checks gate permission tags against the current permissions.
 * Expects: tags are @web, @read:<path>, or @write:<path>.
 */
export async function gatePermissionsCheck(
  permissions: SessionPermissions,
  tags?: string[]
): Promise<GatePermissionsCheckResult> {
  if (!tags || tags.length === 0) {
    return { allowed: true, missing: [] };
  }

  const missing: string[] = [];
  for (const entry of tags) {
    const trimmed = entry.trim();
    if (!trimmed) {
      missing.push("<blank> (Permission tag cannot be blank.)");
      continue;
    }
    const parsed = parsePermissionAccess(trimmed);
    if (!parsed.access) {
      missing.push(`${trimmed} (${parsed.error ?? "Invalid gate permission."})`);
      continue;
    }
    const allowed = await permissionAccessAllows(permissions, parsed.access);
    if (!allowed) {
      missing.push(trimmed);
    }
  }

  return { allowed: missing.length === 0, missing };
}

function parsePermissionAccess(
  tag: string
): { access: PermissionAccess | null; error?: string } {
  if (tag === "@web") {
    return { access: { kind: "web" } };
  }

  if (tag.startsWith("@read:")) {
    const pathValue = tag.slice("@read:".length).trim();
    if (!pathValue) {
      return { access: null, error: "Read permission requires a path." };
    }
    return { access: { kind: "read", path: pathValue } };
  }

  if (tag.startsWith("@write:")) {
    const pathValue = tag.slice("@write:".length).trim();
    if (!pathValue) {
      return { access: null, error: "Write permission requires a path." };
    }
    return { access: { kind: "write", path: pathValue } };
  }

  return {
    access: null,
    error: "Permission must be @web, @read:<path>, or @write:<path>."
  };
}
