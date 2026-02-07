import path from "node:path";

import {
  DEFAULT_ACTORS_PATH,
  DEFAULT_MEMORY_PATH,
  DEFAULT_SOUL_PATH,
  DEFAULT_TOOLS_PATH,
  DEFAULT_USER_PATH
} from "../../paths.js";
import type { SessionPermissions } from "../permissions.js";

export function permissionBuildDefault(
  workingDir: string,
  configDir: string
): SessionPermissions {
  const heartbeatDir = configDir ? path.resolve(configDir, "heartbeat") : null;
  const skillsDir = configDir ? path.resolve(configDir, "skills") : null;
  const writeDefaults = [
    DEFAULT_SOUL_PATH,
    DEFAULT_USER_PATH,
    DEFAULT_ACTORS_PATH,
    DEFAULT_TOOLS_PATH,
    DEFAULT_MEMORY_PATH
  ].map((entry) => path.resolve(entry));
  const writeDirs = [
    path.resolve(workingDir),
    ...writeDefaults,
    ...(heartbeatDir ? [heartbeatDir] : []),
    ...(skillsDir ? [skillsDir] : [])
  ];
  const readDirs = [...writeDirs];
  return {
    workingDir: path.resolve(workingDir),
    writeDirs: Array.from(new Set(writeDirs)),
    readDirs: Array.from(new Set(readDirs)),
    network: false
  };
}
