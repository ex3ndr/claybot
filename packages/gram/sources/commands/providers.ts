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

  const connected = await fetchConnectedProviders(settings);
  if (!connected) {
    console.log("Engine not running; using configured providers.");
  }

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

  await updateSettingsFile(settingsPath, (current) => {
    const providers = listProviders(current);
    const match = providers.find((provider) => provider.id === selected);
    const entry: ProviderSettings = match ?? { id: selected, enabled: true };
    return {
      ...current,
      providers: [entry, ...providers.filter((provider) => provider.id !== selected)]
    };
  });

  outro(`Default provider set to ${selected}. Restart the engine to apply changes.`);
}

async function fetchConnectedProviders(
  settings: SettingsConfig
): Promise<ConnectedProvider[] | null> {
  const socketPath = resolveEngineSocketPath(settings.engine?.socketPath);
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

function intro(message: string): void {
  console.log(message);
}

function outro(message: string): void {
  console.log(message);
}
