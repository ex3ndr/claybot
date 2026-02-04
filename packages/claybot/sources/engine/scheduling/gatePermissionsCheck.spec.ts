import { describe, expect, it } from "vitest";

import type { SessionPermissions } from "@/types";
import { gatePermissionsCheck } from "./gatePermissionsCheck.js";

const basePermissions: SessionPermissions = {
  workingDir: "/tmp",
  readDirs: ["/tmp"],
  writeDirs: ["/tmp"],
  web: false
};

describe("gatePermissionsCheck", () => {
  it("allows empty tags", async () => {
    const result = await gatePermissionsCheck(basePermissions);
    expect(result).toEqual({ allowed: true, missing: [] });
  });

  it("denies web when not allowed", async () => {
    const result = await gatePermissionsCheck(basePermissions, ["@web"]);
    expect(result.allowed).toBe(false);
    expect(result.missing).toEqual(["@web"]);
  });

  it("allows web when permitted", async () => {
    const permissions: SessionPermissions = { ...basePermissions, web: true };
    const result = await gatePermissionsCheck(permissions, ["@web"]);
    expect(result).toEqual({ allowed: true, missing: [] });
  });

  it("denies paths outside allowed roots", async () => {
    const result = await gatePermissionsCheck(basePermissions, ["@read:/etc"]);
    expect(result.allowed).toBe(false);
    expect(result.missing).toEqual(["@read:/etc"]);
  });

  it("reports invalid permission tags", async () => {
    const result = await gatePermissionsCheck(basePermissions, ["@banana"]);
    expect(result.allowed).toBe(false);
    expect(result.missing).toEqual([
      "@banana (Permission must be @web, @read:<path>, or @write:<path>.)"
    ]);
  });
});
