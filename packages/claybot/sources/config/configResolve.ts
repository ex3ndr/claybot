import path from "node:path";

import { resolveEngineSocketPath } from "../engine/ipc/socket.js";
import { resolveWorkspaceDir } from "../engine/permissions.js";
import { permissionBuildDefault } from "../engine/permissions/permissionBuildDefault.js";
import { DEFAULT_CLAYBOT_DIR } from "../paths.js";
import type { SettingsConfig } from "../settings.js";
import { freezeDeep } from "../util/freezeDeep.js";
import type { Config, ConfigOverrides } from "./configTypes.js";

/**
 * Resolves derived paths and defaults into an immutable Config snapshot.
 * Expects: settingsPath is absolute; settings already validated.
 */
export function configResolve(
  settings: SettingsConfig,
  settingsPath: string,
  overrides: ConfigOverrides = {}
): Config {
  const resolvedSettingsPath = path.resolve(settingsPath);
  const configDir = path.dirname(resolvedSettingsPath);
  const dataDir = path.resolve(settings.engine?.dataDir ?? DEFAULT_CLAYBOT_DIR);
  const filesDir = path.join(dataDir, "files");
  const authPath = path.join(dataDir, "auth.json");
  const socketPath = resolveEngineSocketPath(settings.engine?.socketPath);
  const workspaceDir = resolveWorkspaceDir(configDir, settings.assistant ?? null);
  const defaultPermissions = permissionBuildDefault(workspaceDir, configDir);
  const frozenSettings = freezeDeep(structuredClone(settings));
  const frozenPermissions = freezeDeep(defaultPermissions);
  const verbose = overrides.verbose ?? false;

  return freezeDeep({
    settingsPath: resolvedSettingsPath,
    configDir,
    dataDir,
    filesDir,
    authPath,
    socketPath,
    workspaceDir,
    settings: frozenSettings,
    defaultPermissions: frozenPermissions,
    verbose
  });
}
