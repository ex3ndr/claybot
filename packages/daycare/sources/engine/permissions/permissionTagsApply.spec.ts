import { describe, it, expect } from "vitest";

import { permissionTagsApply } from "./permissionTagsApply.js";

describe("permissionTagsApply", () => {
  it("applies tags to permissions", () => {
    const permissions = {
      workingDir: "/tmp",
      writeDirs: [],
      readDirs: [],
      network: false
    };
    permissionTagsApply(permissions, ["@network", "@read:/tmp", "@write:/var/tmp"]);
    expect(permissions.network).toBe(true);
    expect(permissions.readDirs).toContain("/tmp");
    expect(permissions.readDirs).toContain("/var/tmp");
    expect(permissions.writeDirs).toContain("/var/tmp");
  });
});
