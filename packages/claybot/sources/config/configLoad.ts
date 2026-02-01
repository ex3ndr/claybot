import { promises as fs } from "node:fs";
import path from "node:path";

import { DEFAULT_SETTINGS_PATH } from "../settings.js";
import type { Config, ConfigOverrides } from "./configTypes.js";
import { configResolve } from "./configResolve.js";
import { configSettingsParse } from "./configSettingsParse.js";

/**
 * Loads, validates, and resolves the config from disk into an immutable snapshot.
 * Expects: settingsPath points at the JSON settings file.
 */
export async function configLoad(
  settingsPath: string = DEFAULT_SETTINGS_PATH,
  overrides: ConfigOverrides = {}
): Promise<Config> {
  const resolvedPath = path.resolve(settingsPath);
  let raw: unknown = {};

  try {
    const content = await fs.readFile(resolvedPath, "utf8");
    raw = JSON.parse(content) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const settings = configSettingsParse(raw);
  return configResolve(settings, resolvedPath, overrides);
}
