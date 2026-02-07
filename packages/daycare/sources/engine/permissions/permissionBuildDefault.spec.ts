import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MEMORY_PATH,
  DEFAULT_SOUL_PATH,
  DEFAULT_USER_PATH
} from "../../paths.js";
import { permissionBuildDefault } from "./permissionBuildDefault.js";

describe("permissionBuildDefault", () => {
  it("includes default and config directories", () => {
    const workingDir = path.resolve("tmp", "workspace");
    const configDir = path.resolve("tmp", "config");

    const permissions = permissionBuildDefault(workingDir, configDir);

    expect(permissions.workingDir).toBe(path.resolve(workingDir));
    expect(permissions.writeDirs).toEqual(
      expect.arrayContaining([
        path.resolve(workingDir),
        path.resolve(DEFAULT_SOUL_PATH),
        path.resolve(DEFAULT_USER_PATH),
        path.resolve(DEFAULT_MEMORY_PATH),
        path.resolve(configDir, "heartbeat"),
        path.resolve(configDir, "skills")
      ])
    );
    expect(permissions.readDirs).toEqual(expect.arrayContaining(permissions.writeDirs));
    expect(permissions.network).toBe(false);
  });
});
