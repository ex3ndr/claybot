import { promises as fs } from "node:fs";
import path from "node:path";

import type { CronTaskConfig } from "./modules/runtime/cron.js";
import type {
  DockerContainerConfig,
  DockerRuntimeConfig
} from "./modules/runtime/containers.js";
import type { Pm2ProcessConfig } from "./modules/runtime/pm2.js";

export type PluginSettings = {
  id: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
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
  plugins?: PluginSettings[];
  inference?: {
    providers?: InferenceProviderSettings[];
  };
  cron?: {
    tasks?: CronTaskConfig[];
  };
  runtime?: {
    pm2?: Pm2Config | Pm2ProcessConfig[];
    containers?: DockerRuntimeConfig | DockerContainerConfig[];
  };
  memory?: {
    enabled?: boolean;
    maxEntries?: number;
  };
};

export type AssistantSettings = {
  workspaceDir?: string;
  containerWorkspacePath?: string;
  allowedDockerImages?: string[];
  allowedDockerContainers?: string[];
  allowedPm2Processes?: string[];
};

export type Pm2Config = {
  processes?: Pm2ProcessConfig[];
  connectTimeoutMs?: number;
  disconnectOnExit?: boolean;
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

export function listPlugins(settings: SettingsConfig): PluginSettings[] {
  return settings.plugins ?? [];
}

export function listEnabledPlugins(settings: SettingsConfig): PluginSettings[] {
  return (settings.plugins ?? []).filter((plugin) => plugin.enabled !== false);
}

export function upsertPlugin(
  plugins: PluginSettings[] | undefined,
  entry: PluginSettings
): PluginSettings[] {
  const list = plugins ?? [];
  const filtered = list.filter((item) => item.id !== entry.id);
  return [...filtered, entry];
}

export function removePlugin(
  plugins: PluginSettings[] | undefined,
  id: string
): PluginSettings[] {
  return (plugins ?? []).filter((item) => item.id !== id);
}

export function listInferenceProviders(
  settings: SettingsConfig
): InferenceProviderSettings[] {
  return settings.inference?.providers ?? [];
}
