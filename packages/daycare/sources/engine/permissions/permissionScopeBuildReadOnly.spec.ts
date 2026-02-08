import { describe, expect, it } from "vitest";

import { permissionScopeBuildReadOnly } from "./permissionScopeBuildReadOnly.js";

describe("permissionScopeBuildReadOnly", () => {
  it("keeps unrestricted read semantics when caller has empty readDirs", () => {
    const scoped = permissionScopeBuildReadOnly({
      workingDir: "/workspace",
      writeDirs: ["/workspace"],
      readDirs: [],
      network: true
    });

    expect(scoped).toEqual({
      workingDir: "/workspace",
      writeDirs: [],
      readDirs: [],
      network: false
    });
  });

  it("keeps caller read scope while removing write and network", () => {
    const scoped = permissionScopeBuildReadOnly({
      workingDir: "/workspace",
      writeDirs: ["/workspace", "/tmp"],
      readDirs: ["/workspace", "/tmp/read-only"],
      network: true
    });

    expect(scoped.workingDir).toBe("/workspace");
    expect(scoped.writeDirs).toEqual([]);
    expect(scoped.network).toBe(false);
    expect(scoped.readDirs).toEqual(
      expect.arrayContaining(["/workspace", "/tmp", "/tmp/read-only"])
    );
  });
});
