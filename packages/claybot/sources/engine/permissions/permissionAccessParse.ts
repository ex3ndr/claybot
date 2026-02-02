import type { PermissionAccess } from "@/types";

/**
 * Parses a permission tag string into a PermissionAccess union.
 * Expects: value is @web, @read:<path>, or @write:<path>.
 */
export function permissionAccessParse(value: string): PermissionAccess {
  const trimmed = value.trim();
  if (trimmed === "@web") {
    return { kind: "web" };
  }
  if (trimmed.startsWith("@read:")) {
    const pathValue = trimmed.slice("@read:".length).trim();
    if (!pathValue) {
      throw new Error("Read permission requires a path.");
    }
    return { kind: "read", path: pathValue };
  }
  if (trimmed.startsWith("@write:")) {
    const pathValue = trimmed.slice("@write:".length).trim();
    if (!pathValue) {
      throw new Error("Write permission requires a path.");
    }
    return { kind: "write", path: pathValue };
  }
  throw new Error("Permission must be @web, @read:<path>, or @write:<path>.");
}
