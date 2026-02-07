import { describe, it, expect } from "vitest";
import path from "node:path";

import { permissionAccessApply } from "./permissionAccessApply.js";

describe("permissionAccessApply", () => {
  const basePermissions = () => ({
    workingDir: "/tmp",
    writeDirs: [] as string[],
    readDirs: [] as string[],
    network: false
  });

  it("applies network access", () => {
    const permissions = basePermissions();
    const applied = permissionAccessApply(permissions, { kind: "network" });
    expect(applied).toBe(true);
    expect(permissions.network).toBe(true);
  });

  it("applies read/write paths", () => {
    const permissions = basePermissions();
    const readPath = path.resolve("/tmp/read");
    const writePath = path.resolve("/tmp/write");
    expect(permissionAccessApply(permissions, { kind: "read", path: readPath })).toBe(true);
    expect(permissionAccessApply(permissions, { kind: "write", path: writePath })).toBe(true);
    expect(permissions.readDirs).toContain(readPath);
    expect(permissions.readDirs).toContain(writePath);
    expect(permissions.writeDirs).toContain(writePath);
  });

  it("rejects non-absolute paths", () => {
    const permissions = basePermissions();
    const applied = permissionAccessApply(permissions, { kind: "read", path: "relative" });
    expect(applied).toBe(false);
    expect(permissions.readDirs).toHaveLength(0);
  });
});
