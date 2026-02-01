import type { PermissionAccess } from "@/types";

export function permissionFormatTag(access: PermissionAccess): string {
  if (access.kind === "web") {
    return "@web";
  }
  return `@${access.kind}:${access.path}`;
}
