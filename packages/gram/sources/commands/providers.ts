import { promises as fs } from "node:fs";
import path from "node:path";

import { promptSelect } from "./prompts.js";
import { requestSocket } from "../engine/ipc/client.js";
import { resolveEngineSocketPath } from "../engine/ipc/socket.js";
import {
  DEFAULT_SETTINGS_PATH,
  listProviders,
  readSettingsFile,
  updateSettingsFile,
  type ProviderSettings,
  type SettingsConfig
} from "../settings.js";
import { getProviderDefinition } from "../providers/catalog.js";

export type ProviderCommandOptions = {
  settings?: string;
};

type ConnectedProvider = {
  id: string;
  label?: string;
};

export async function setDefaultProviderCommand(
  options: ProviderCommandOptions
): Promise<void> {
  intro("gram providers");

  const settingsPath = path.resolve(options.settings ?? DEFAULT_SETTINGS_PATH);
  const settings = await readSettingsFile(settingsPath);

  const connected = await fetchConnectedProviders(settings, settingsPath);

  const configuredProviders = listProviders(settings).filter(
    (provider) => provider.enabled !== false
  );
  const providers: ConnectedProvider[] =
    connected ?? configuredProviders.map((provider) => ({ id: provider.id }));

  if (providers.length === 0) {
    outro(connected ? "No connected providers." : "No configured providers.");
    return;
  }

  const choices = providers.map((provider) => {
    const definition = getProviderDefinition(provider.id);
    return {
      value: provider.id,
      name: definition?.name ?? provider.label ?? provider.id,
      description: definition?.description
    };
  });

  const selected = await promptSelect({
    message: "Select default provider",
    choices
  });

  if (!selected) {
    outro("Cancelled.");
    return;
  }

  const definition = getProviderDefinition(selected);
  if (!definition) {
    outro("Unknown provider selection.");
    return;
  }

  const configured = listProviders(settings);
  const currentProvider = configured.find((provider) => provider.id === selected);

  let selectedModel: string | null = null;
  if (definition.models && definition.models.length > 0) {
    const keepValue = "__keep__";
    const currentModel = currentProvider?.model;
    const modelChoices = [
      ...(currentModel
        ? [
            {
              value: keepValue,
              name: `Keep current model (${currentModel})`
            }
          ]
        : []),
      ...definition.models.map((model) => ({
        value: model.id,
        name: model.name,
        description:
          model.size === "unknown" ? model.id : `${model.id} · ${model.size}`
      }))
    ];

    const modelSelection = await promptSelect({
      message: `Select model for ${definition.name}`,
      choices: modelChoices
    });

    if (!modelSelection) {
      outro("Cancelled.");
      return;
    }

    if (modelSelection !== keepValue) {
      selectedModel = modelSelection;
    }
  }

  await updateSettingsFile(settingsPath, (current) => {
    const providers = listProviders(current);
    const match = providers.find((provider) => provider.id === selected);
    const entry: ProviderSettings = match ?? { id: selected, enabled: true };
    if (selectedModel) {
      entry.model = selectedModel;
    }
    return {
      ...current,
      providers: [entry, ...providers.filter((provider) => provider.id !== selected)]
    };
  });

  outro("Default provider updated.");
}

async function fetchConnectedProviders(
  settings: SettingsConfig,
  settingsPath: string
): Promise<ConnectedProvider[] | null> {
  const socketPath = resolveEngineSocketPath(settings.engine?.socketPath);
  const pidPath = path.join(path.dirname(settingsPath), "engine.pid");
  const pid = await readPidFile(pidPath);
  if (!pid || !isProcessRunning(pid)) {
    return null;
  }
  try {
    const response = await requestSocket({
      socketPath,
      path: "/v1/engine/status"
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return null;
    }
    const payload = JSON.parse(response.body) as {
      ok?: boolean;
      status?: {
        providers?: string[];
        inferenceProviders?: ConnectedProvider[];
      };
    };
    if (!payload?.status) {
      return [];
    }
    const loaded = new Set(payload.status.providers ?? []);
    const inference = payload.status.inferenceProviders ?? [];
    if (inference.length > 0) {
      return inference.filter((provider) => loaded.size === 0 || loaded.has(provider.id));
    }
    return Array.from(loaded).map((id) => ({ id, label: id }));
  } catch (error) {
    return null;
  }
}

async function readPidFile(pidPath: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(pidPath, "utf8");
    const parsed = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== "ESRCH";
  }
}

function intro(message: string): void {
  console.log(message);
}

function outro(message: string): void {
  console.log(message);
}
