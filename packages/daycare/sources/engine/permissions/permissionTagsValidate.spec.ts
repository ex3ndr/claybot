import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { permissionTagsValidate } from "./permissionTagsValidate.js";

describe("permissionTagsValidate", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("allows tags the caller already has", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "perm-validate-"));
    tempDirs.push(dir);
    const target = path.join(dir, "file.txt");
    await fs.writeFile(target, "ok", "utf8");

    const permissions = {
      workingDir: dir,
      writeDirs: [dir],
      readDirs: [dir],
      network: true
    };

    // Should not throw
    await permissionTagsValidate(permissions, ["@network", `@read:${target}`, `@write:${dir}`]);
  });

  it("rejects network permission when caller lacks it", async () => {
    const permissions = {
      workingDir: "/tmp",
      writeDirs: [],
      readDirs: [],
      network: false
    };

    await expect(permissionTagsValidate(permissions, ["@network"]))
      .rejects.toThrow("Cannot attach permission '@network' - you don't have it.");
  });

  it("rejects write permission outside allowed directories", async () => {
    const permissions = {
      workingDir: "/tmp",
      writeDirs: ["/tmp"],
      readDirs: [],
      network: false
    };

    await expect(permissionTagsValidate(permissions, ["@write:/etc"]))
      .rejects.toThrow("Cannot attach permission '@write:/etc' - you don't have it.");
  });

  it("rejects read permission outside allowed directories", async () => {
    const permissions = {
      workingDir: "/tmp",
      writeDirs: [],
      readDirs: ["/tmp"],
      network: false
    };

    await expect(permissionTagsValidate(permissions, ["@read:/etc"]))
      .rejects.toThrow("Cannot attach permission '@read:/etc' - you don't have it.");
  });

  it("allows read tags for any absolute path when readDirs are empty", async () => {
    const permissions = {
      workingDir: "/tmp",
      writeDirs: [],
      readDirs: [],
      network: false
    };

    await expect(
      permissionTagsValidate(permissions, ["@read:/etc"])
    ).resolves.toBeUndefined();
  });
});
