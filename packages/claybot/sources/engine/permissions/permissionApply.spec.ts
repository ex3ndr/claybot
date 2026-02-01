import path from "node:path";

import { describe, expect, it } from "vitest";

import type { PermissionDecision } from "@/types";
import type { SessionPermissions } from "../permissions.js";
import { permissionApply } from "./permissionApply.js";

describe("permissionApply", () => {
  const basePermissions = (): SessionPermissions => ({
    workingDir: "/workspace",
    writeDirs: [],
    readDirs: [],
    web: false
  });

  it("ignores unapproved decisions", () => {
    const permissions = basePermissions();
    const decision: PermissionDecision = {
      token: "token-1",
      approved: false,
      permission: "@web",
      access: { kind: "web" }
    };

    permissionApply(permissions, decision);

    expect(permissions.web).toBe(false);
  });

  it("adds approved write paths", () => {
    const permissions = basePermissions();
    const target = path.resolve("tmp", "write");
    const decision: PermissionDecision = {
      token: "token-2",
      approved: true,
      permission: `@write:${target}`,
      access: { kind: "write", path: target }
    };

    permissionApply(permissions, decision);

    expect(permissions.writeDirs).toEqual(expect.arrayContaining([target]));
  });

  it("skips relative paths", () => {
    const permissions = basePermissions();
    const decision: PermissionDecision = {
      token: "token-3",
      approved: true,
      permission: "@read:relative/path",
      access: { kind: "read", path: "relative/path" }
    };

    permissionApply(permissions, decision);

    expect(permissions.readDirs).toHaveLength(0);
  });

  it("rejects paths with null bytes", () => {
    const permissions = basePermissions();
    const decision: PermissionDecision = {
      token: "token-4",
      approved: true,
      permission: "@read:/etc/passwd\x00.txt",
      access: { kind: "read", path: "/etc/passwd\x00.txt" }
    };

    permissionApply(permissions, decision);

    // Path should be silently rejected
    expect(permissions.readDirs).toHaveLength(0);
  });

  it("rejects paths with control characters", () => {
    const permissions = basePermissions();
    const decision: PermissionDecision = {
      token: "token-5",
      approved: true,
      permission: "@write:/home/user\x01file",
      access: { kind: "write", path: "/home/user\x01file" }
    };

    permissionApply(permissions, decision);

    expect(permissions.writeDirs).toHaveLength(0);
  });

  it("rejects excessively long paths", () => {
    const permissions = basePermissions();
    const longPath = "/" + "a".repeat(5000);
    const decision: PermissionDecision = {
      token: "token-6",
      approved: true,
      permission: `@read:${longPath}`,
      access: { kind: "read", path: longPath }
    };

    permissionApply(permissions, decision);

    expect(permissions.readDirs).toHaveLength(0);
  });
});
