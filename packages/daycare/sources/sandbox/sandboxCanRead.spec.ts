import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SessionPermissions } from "@/types";
import { sandboxCanRead } from "./sandboxCanRead.js";

describe("sandboxCanRead", () => {
  let workingDir: string;
  let outsideDir: string;
  let outsideFile: string;

  beforeEach(async () => {
    workingDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-can-read-workspace-"));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-can-read-outside-"));
    outsideFile = path.join(outsideDir, "outside.txt");
    await fs.writeFile(outsideFile, "outside-content", "utf8");
  });

  afterEach(async () => {
    await fs.rm(workingDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it("allows reading any absolute path when readDirs is empty", async () => {
    const permissions = buildPermissions(workingDir, [], []);

    const result = await sandboxCanRead(permissions, outsideFile);

    expect(result).toBe(await fs.realpath(outsideFile));
  });

  it("allows reading any absolute path when readDirs are configured", async () => {
    const permissions = buildPermissions(workingDir, [workingDir], []);

    const result = await sandboxCanRead(permissions, outsideFile);

    expect(result).toBe(await fs.realpath(outsideFile));
  });

  it("ignores write grants for read access checks", async () => {
    const permissions = buildPermissions(workingDir, [workingDir], [outsideFile]);

    const result = await sandboxCanRead(permissions, outsideFile);

    expect(result).toBe(await fs.realpath(outsideFile));
  });
});

function buildPermissions(
  workingDir: string,
  readDirs: string[],
  writeDirs: string[]
): SessionPermissions {
  return {
    workingDir: path.resolve(workingDir),
    readDirs: readDirs.map((entry) => path.resolve(entry)),
    writeDirs: writeDirs.map((entry) => path.resolve(entry)),
    network: false
  };
}
