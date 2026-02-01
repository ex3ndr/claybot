import { promises as fs } from "node:fs";
import path from "node:path";

import type { CronTaskDefinition as CronTaskConfig } from "./engine/cron/cronTypes.js";
import { resolveClaybotPath } from "./paths.js";

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

export type ProviderImageSettings = {
  enabled?: boolean;
  model?: string;
  size?: string;
  quality?: "standard" | "hd";
  endpoint?: string;
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
};

export type ProviderSettings = {
  id: string;
  enabled?: boolean;
  model?: string;
  options?: Record<string, unknown>;
  image?: ProviderImageSettings;
};

export type SettingsConfig = {
  engine?: {
    socketPath?: string;
    dataDir?: string;
  };
  assistant?: AssistantSettings;
  plugins?: Array<PluginInstanceSettings | LegacyPluginSettings>;
  providers?: ProviderSettings[];
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
  systemPrompt?: string;
};

export const DEFAULT_SETTINGS_PATH = resolveClaybotPath("settings.json");

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

export type NextPluginInstanceIdOptions = {
  exclusive?: boolean;
};

export function nextPluginInstanceId(
  pluginId: string,
  plugins: Array<PluginInstanceSettings | LegacyPluginSettings> | undefined,
  options?: NextPluginInstanceIdOptions
): string {
  // Exclusive plugins can only be installed once - always use bare pluginId
  if (options?.exclusive) {
    return pluginId;
  }

  const list = normalizePlugins(plugins ?? []);
  const used = new Set(list.map((plugin) => plugin.instanceId));

  // First instance uses bare pluginId without suffix
  if (!used.has(pluginId)) {
    return pluginId;
  }

  // Subsequent instances use -2, -3, etc.
  let index = 2;
  while (used.has(`${pluginId}-${index}`)) {
    index += 1;
  }
  return `${pluginId}-${index}`;
}

export function removePlugin(
  plugins: Array<PluginInstanceSettings | LegacyPluginSettings> | undefined,
  instanceId: string
): PluginInstanceSettings[] {
  return normalizePlugins(plugins ?? []).filter((item) => item.instanceId !== instanceId);
}

export function listProviders(settings: SettingsConfig): ProviderSettings[] {
  if (settings.providers && settings.providers.length > 0) {
    return settings.providers.map((provider) => ({ ...provider }));
  }
  return (settings.inference?.providers ?? []).map((provider) => ({
    id: provider.id,
    enabled: true,
    model: provider.model,
    options: provider.options
  }));
}

export function listActiveProviders(settings: SettingsConfig): ProviderSettings[] {
  return listProviders(settings).filter((provider) => provider.enabled !== false);
}

export function upsertProviderSettings(
  providers: ProviderSettings[] | undefined,
  entry: ProviderSettings
): ProviderSettings[] {
  const list = providers ? [...providers] : [];
  const filtered = list.filter((provider) => provider.id !== entry.id);
  return [entry, ...filtered];
}

export function removeProviderSettings(
  providers: ProviderSettings[] | undefined,
  id: string
): ProviderSettings[] {
  return (providers ?? []).filter((provider) => provider.id !== id);
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
