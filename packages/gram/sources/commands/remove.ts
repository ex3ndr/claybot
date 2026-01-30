import path from "node:path";

import { promptSelect } from "./prompts.js";

import {
  DEFAULT_SETTINGS_PATH,
  listPlugins,
  readSettingsFile,
  removePlugin,
  updateSettingsFile
} from "../settings.js";
import { PROVIDER_DEFINITIONS } from "../engine/plugins/providers.js";
import { buildPluginCatalog } from "../engine/plugins/catalog.js";

export type RemoveOptions = {
  settings?: string;
};

type ProviderSelection = {
  kind: "provider";
  index: number;
  id: string;
  model?: string;
  label: string;
};

type PluginSelection = {
  kind: "plugin";
  instanceId: string;
  pluginId: string;
  label: string;
};

export async function removeCommand(options: RemoveOptions): Promise<void> {
  intro("gram remove");

  const settingsPath = path.resolve(options.settings ?? DEFAULT_SETTINGS_PATH);
  const settings = await readSettingsFile(settingsPath);
  const catalog = buildPluginCatalog();

  const providerLabels = new Map(PROVIDER_DEFINITIONS.map((provider) => [provider.id, provider.label]));
  const providerSelections: ProviderSelection[] = (settings.inference?.providers ?? []).map(
    (provider, index) => ({
      kind: "provider",
      index,
      id: provider.id,
      model: provider.model,
      label: providerLabels.get(provider.id) ?? provider.id
    })
  );

  const pluginSelections: PluginSelection[] = listPlugins(settings).map((plugin) => {
    const descriptor = catalog.get(plugin.pluginId)?.descriptor;
    const label = descriptor?.name ?? plugin.pluginId;
    return {
      kind: "plugin",
      instanceId: plugin.instanceId,
      pluginId: plugin.pluginId,
      label
    };
  });

  const choices = [
    ...providerSelections.map((provider) => ({
      value: `provider:${provider.index}`,
      name: `${provider.label} (${provider.id})`,
      description: provider.model ?? "default"
    })),
    ...pluginSelections.map((plugin) => ({
      value: `plugin:${plugin.instanceId}`,
      name: plugin.instanceId === plugin.pluginId
        ? plugin.label
        : `${plugin.label} (${plugin.instanceId})`,
      description: plugin.pluginId
    }))
  ];

  if (choices.length === 0) {
    outro("Nothing to remove.");
    return;
  }

  const selection = await promptSelect({
    message: "Select a provider or plugin to remove",
    choices
  });

  if (selection === null) {
    outro("Cancelled.");
    return;
  }

  if (selection.startsWith("provider:")) {
    const index = Number(selection.replace("provider:", ""));
    const provider = providerSelections.find((entry) => entry.index === index);
    if (!provider) {
      outro("Unknown provider selection.");
      return;
    }

    await updateSettingsFile(settingsPath, (current) => {
      const providers = current.inference?.providers ?? [];
      const removed = providers[index];
      if (!removed) {
        return current;
      }
      const nextProviders = providers.filter((_, idx) => idx !== index);
      const stillHasProvider = nextProviders.some((entry) => entry.id === removed.id);
      const nextPlugins = stillHasProvider
        ? current.plugins
        : removePlugin(current.plugins, removed.id);
      return {
        ...current,
        plugins: nextPlugins,
        inference: {
          ...(current.inference ?? {}),
          providers: nextProviders
        }
      };
    });

    outro(
      `Removed ${provider.label} (${provider.id}${provider.model ? `:${provider.model}` : ""}). Restart the engine to apply changes.`
    );
    return;
  }

  if (selection.startsWith("plugin:")) {
    const instanceId = selection.replace("plugin:", "");
    const plugin = pluginSelections.find((entry) => entry.instanceId === instanceId);
    if (!plugin) {
      outro("Unknown plugin selection.");
      return;
    }

    await updateSettingsFile(settingsPath, (current) => ({
      ...current,
      plugins: removePlugin(current.plugins, instanceId)
    }));

    outro(
      `Removed ${plugin.label} (${plugin.instanceId}). Restart the engine to apply changes.`
    );
  }
}

function intro(message: string): void {
  console.log(message);
}

function outro(message: string): void {
  console.log(message);
}
