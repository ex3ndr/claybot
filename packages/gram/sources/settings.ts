import { promises as fs } from "node:fs";
import path from "node:path";

import type { CronTaskConfig } from "./modules/runtime/cron.js";

export type LegacyPluginSettings = {
  id: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
};

export type PluginInstanceSettings = {
  instanceId: string;
  pluginId: string;
  enabled?: boolean;
  settings?: Record<string, unknown>;
};

export type InferenceProviderSettings = {
  id: string;
  model?: string;
  options?: Record<string, unknown>;
};

export type SettingsConfig = {
  engine?: {
    socketPath?: string;
    dataDir?: string;
  };
  assistant?: AssistantSettings;
  plugins?: Array<PluginInstanceSettings | LegacyPluginSettings>;
  inference?: {
    providers?: InferenceProviderSettings[];
  };
  cron?: {
    tasks?: CronTaskConfig[];
  };
  memory?: {
    enabled?: boolean;
    maxEntries?: number;
  };
};

export type AssistantSettings = {
  workspaceDir?: string;
};

export const DEFAULT_SETTINGS_PATH = ".scout/settings.json";

export async function readSettingsFile(
  filePath: string = DEFAULT_SETTINGS_PATH
): Promise<SettingsConfig> {
  const resolvedPath = path.resolve(filePath);

  try {
    const raw = await fs.readFile(resolvedPath, "utf8");
    return JSON.parse(raw) as SettingsConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function writeSettingsFile(
  filePath: string,
  settings: SettingsConfig
): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  const dir = path.dirname(resolvedPath);

  if (dir && dir !== ".") {
    await fs.mkdir(dir, { recursive: true });
  }

  await fs.writeFile(resolvedPath, `${JSON.stringify(settings, null, 2)}\n`, {
    mode: 0o600
  });
}

export async function updateSettingsFile(
  filePath: string,
  updater: (settings: SettingsConfig) => SettingsConfig
): Promise<SettingsConfig> {
  const settings = await readSettingsFile(filePath);
  const updated = updater(settings);
  await writeSettingsFile(filePath, updated);
  return updated;
}

export function listPlugins(settings: SettingsConfig): PluginInstanceSettings[] {
  return normalizePlugins(settings.plugins ?? []);
}

export function listEnabledPlugins(settings: SettingsConfig): PluginInstanceSettings[] {
  return listPlugins(settings).filter((plugin) => plugin.enabled !== false);
}

export function upsertPlugin(
  plugins: Array<PluginInstanceSettings | LegacyPluginSettings> | undefined,
  entry: PluginInstanceSettings
): PluginInstanceSettings[] {
  const list = normalizePlugins(plugins ?? []);
  const filtered = list.filter((item) => item.instanceId !== entry.instanceId);
  return [...filtered, entry];
}

export function removePlugin(
  plugins: Array<PluginInstanceSettings | LegacyPluginSettings> | undefined,
  instanceId: string
): PluginInstanceSettings[] {
  return normalizePlugins(plugins ?? []).filter((item) => item.instanceId !== instanceId);
}

export function listInferenceProviders(
  settings: SettingsConfig
): InferenceProviderSettings[] {
  return settings.inference?.providers ?? [];
}

function normalizePlugins(
  plugins: Array<PluginInstanceSettings | LegacyPluginSettings>
): PluginInstanceSettings[] {
  return plugins.map((plugin) => normalizePlugin(plugin));
}

function normalizePlugin(
  plugin: PluginInstanceSettings | LegacyPluginSettings
): PluginInstanceSettings {
  if ("instanceId" in plugin && "pluginId" in plugin) {
    return plugin;
  }
  return {
    instanceId: plugin.id,
    pluginId: plugin.id,
    enabled: plugin.enabled,
    settings: plugin.config
  };
}
