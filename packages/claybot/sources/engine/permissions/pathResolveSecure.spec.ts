import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { pathResolveSecure, isWithinSecure, openSecure } from "./pathResolveSecure.js";

describe("pathResolveSecure", () => {
  let tempDir: string;
  let realTempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "path-resolve-test-"));
    // On macOS, /var is a symlink to /private/var, so we need the real path
    realTempDir = await fs.realpath(tempDir);
    await fs.mkdir(path.join(tempDir, "allowed"));
    await fs.mkdir(path.join(tempDir, "forbidden"));
    await fs.writeFile(path.join(tempDir, "allowed", "file.txt"), "content");
    await fs.writeFile(path.join(tempDir, "forbidden", "secret.txt"), "secret");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("resolves paths within allowed directories", async () => {
    const allowedDirs = [path.join(tempDir, "allowed")];
    const result = await pathResolveSecure(
      allowedDirs,
      path.join(tempDir, "allowed", "file.txt")
    );
    // fs.realpath resolves symlinks, so we compare against realTempDir
    expect(result.realPath).toBe(path.join(realTempDir, "allowed", "file.txt"));
    expect(result.allowedBase).toBe(path.join(realTempDir, "allowed"));
  });

  it("rejects paths outside allowed directories", async () => {
    const allowedDirs = [path.join(tempDir, "allowed")];
    await expect(
      pathResolveSecure(allowedDirs, path.join(tempDir, "forbidden", "secret.txt"))
    ).rejects.toThrow("Path is outside the allowed directories.");
  });

  it("prevents symlink escape attack", async () => {
    // Create symlink inside allowed dir pointing outside
    const symlinkPath = path.join(tempDir, "allowed", "escape");
    await fs.symlink(path.join(tempDir, "forbidden"), symlinkPath);

    const allowedDirs = [path.join(tempDir, "allowed")];

    // Attempting to access forbidden/secret.txt via symlink should fail
    await expect(
      pathResolveSecure(allowedDirs, path.join(symlinkPath, "secret.txt"))
    ).rejects.toThrow("Path is outside the allowed directories.");
  });

  it("allows symlinks that resolve within allowed dirs", async () => {
    // Create symlink within allowed dir pointing to another file in allowed
    await fs.mkdir(path.join(tempDir, "allowed", "subdir"));
    await fs.writeFile(path.join(tempDir, "allowed", "subdir", "data.txt"), "data");
    const symlinkPath = path.join(tempDir, "allowed", "link");
    await fs.symlink(path.join(tempDir, "allowed", "subdir"), symlinkPath);

    const allowedDirs = [path.join(tempDir, "allowed")];
    const result = await pathResolveSecure(
      allowedDirs,
      path.join(symlinkPath, "data.txt")
    );
    expect(result.realPath).toBe(path.join(realTempDir, "allowed", "subdir", "data.txt"));
  });

  it("handles non-existent files for write operations", async () => {
    const allowedDirs = [path.join(tempDir, "allowed")];
    const result = await pathResolveSecure(
      allowedDirs,
      path.join(tempDir, "allowed", "newfile.txt")
    );
    expect(result.realPath).toBe(path.join(realTempDir, "allowed", "newfile.txt"));
  });

  it("rejects paths with null bytes", async () => {
    const allowedDirs = [path.join(tempDir, "allowed")];
    await expect(
      pathResolveSecure(allowedDirs, path.join(tempDir, "allowed\x00forbidden"))
    ).rejects.toThrow("Path contains null byte.");
  });

  it("rejects relative paths", async () => {
    const allowedDirs = [path.join(tempDir, "allowed")];
    await expect(
      pathResolveSecure(allowedDirs, "relative/path")
    ).rejects.toThrow("Path must be absolute.");
  });
});

describe("isWithinSecure", () => {
  it("returns true for paths within base", () => {
    expect(isWithinSecure("/home/user", "/home/user/file.txt")).toBe(true);
    expect(isWithinSecure("/home/user", "/home/user/sub/file.txt")).toBe(true);
    expect(isWithinSecure("/home/user", "/home/user")).toBe(true);
  });

  it("returns false for paths outside base", () => {
    expect(isWithinSecure("/home/user", "/home/other/file.txt")).toBe(false);
    expect(isWithinSecure("/home/user", "/etc/passwd")).toBe(false);
    expect(isWithinSecure("/home/user", "/home/user/../other")).toBe(false);
  });
});

describe("openSecure", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "open-secure-test-"));
    await fs.writeFile(path.join(tempDir, "regular.txt"), "content");
    await fs.mkdir(path.join(tempDir, "target"));
    await fs.writeFile(path.join(tempDir, "target", "secret.txt"), "secret");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("opens regular files", async () => {
    const handle = await openSecure(path.join(tempDir, "regular.txt"), "r");
    const content = await handle.readFile("utf8");
    await handle.close();
    expect(content).toBe("content");
  });

  it("rejects symlinks", async () => {
    const symlinkPath = path.join(tempDir, "link.txt");
    await fs.symlink(path.join(tempDir, "regular.txt"), symlinkPath);

    await expect(openSecure(symlinkPath, "r")).rejects.toThrow(
      "Cannot open symbolic link directly."
    );
  });

  it("allows creating new files", async () => {
    const newPath = path.join(tempDir, "new.txt");
    const handle = await openSecure(newPath, "w");
    await handle.writeFile("new content");
    await handle.close();

    const content = await fs.readFile(newPath, "utf8");
    expect(content).toBe("new content");
  });

  it("rejects paths with null bytes", async () => {
    await expect(
      openSecure(path.join(tempDir, "file\x00.txt"), "r")
    ).rejects.toThrow("Path contains null byte.");
  });
});
