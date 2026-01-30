import { loadPlugin, unloadPlugin } from "../engine/ipc/client.js";

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

function intro(message: string): void {
  console.log(message);
}

function outro(message: string): void {
  console.log(message);
}
