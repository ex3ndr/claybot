import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { permissionAccessAllows } from "./permissionAccessAllows.js";

describe("permissionAccessAllows", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("allows network access when enabled", async () => {
    const allowed = await permissionAccessAllows(
      { workingDir: "/tmp", writeDirs: [], readDirs: [], network: true },
      { kind: "network" }
    );
    expect(allowed).toBe(true);
  });

  it("allows read access within allowed directories", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "perm-allow-"));
    tempDirs.push(dir);
    const target = path.join(dir, "file.txt");
    await fs.writeFile(target, "ok", "utf8");
    const allowed = await permissionAccessAllows(
      { workingDir: dir, writeDirs: [], readDirs: [dir], network: false },
      { kind: "read", path: target }
    );
    expect(allowed).toBe(true);
  });

  it("treats empty readDirs as unrestricted read access", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "perm-workspace-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "perm-outside-"));
    tempDirs.push(workspaceDir, outsideDir);
    const outsideFile = path.join(outsideDir, "outside.txt");
    await fs.writeFile(outsideFile, "ok", "utf8");

    const allowed = await permissionAccessAllows(
      { workingDir: workspaceDir, writeDirs: [], readDirs: [], network: false },
      { kind: "read", path: outsideFile }
    );

    expect(allowed).toBe(true);
  });

  it("denies write access outside allowed directories", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "perm-deny-"));
    tempDirs.push(dir);
    const target = path.join(dir, "elsewhere", "file.txt");
    const allowed = await permissionAccessAllows(
      { workingDir: "/tmp", writeDirs: ["/tmp"], readDirs: [], network: false },
      { kind: "write", path: target }
    );
    expect(allowed).toBe(false);
  });

  it("does not imply write access from workingDir", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "perm-working-dir-"));
    tempDirs.push(dir);
    const target = path.join(dir, "file.txt");
    const allowed = await permissionAccessAllows(
      { workingDir: dir, writeDirs: [], readDirs: [], network: false },
      { kind: "write", path: target }
    );
    expect(allowed).toBe(false);
  });

  it("allows write access when path is explicitly in writeDirs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "perm-write-dir-"));
    tempDirs.push(dir);
    const target = path.join(dir, "file.txt");
    const allowed = await permissionAccessAllows(
      { workingDir: "/tmp", writeDirs: [dir], readDirs: [], network: false },
      { kind: "write", path: target }
    );
    expect(allowed).toBe(true);
  });
});
