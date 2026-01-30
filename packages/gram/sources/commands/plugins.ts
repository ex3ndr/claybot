import { intro, outro } from "@clack/prompts";

import { loadPlugin, unloadPlugin } from "../engine/client.js";

export async function loadPluginCommand(
  pluginId: string,
  instanceId?: string
): Promise<void> {
  intro("gram plugins");
  await loadPlugin({ pluginId, instanceId });
  const label = instanceId ? `${pluginId} (${instanceId})` : pluginId;
  outro(`Loaded plugin ${label}.`);
}

export async function unloadPluginCommand(instanceId: string): Promise<void> {
  intro("gram plugins");
  await unloadPlugin(instanceId);
  outro(`Unloaded plugin ${instanceId}.`);
}
