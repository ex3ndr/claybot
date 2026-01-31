import path from "node:path";

import { AuthStore } from "../auth/store.js";
import { promptConfirm, promptInput, promptSelect } from "./prompts.js";
import { ConnectorRegistry, ImageGenerationRegistry, InferenceRegistry, ToolResolver } from "../engine/modules.js";
import { FileStore } from "../files/store.js";
import { InferenceRouter } from "../engine/inference/router.js";
import { PluginManager } from "../engine/plugins/manager.js";
import { buildPluginCatalog, type PluginDefinition } from "../engine/plugins/catalog.js";
import { PluginEventQueue } from "../engine/plugins/events.js";
import { PluginRegistry } from "../engine/plugins/registry.js";
import { PluginModuleLoader } from "../engine/plugins/loader.js";
import {
  DEFAULT_SETTINGS_PATH,
  readSettingsFile,
  updateSettingsFile,
  upsertPlugin,
  nextPluginInstanceId,
  listEnabledPlugins,
  listProviders,
  upsertProviderSettings,
  type PluginInstanceSettings,
  type ProviderSettings
} from "../settings.js";
import { listActiveInferenceProviders, listProviderDefinitions, getProviderDefinition } from "../providers/catalog.js";
import type { ProviderDefinition } from "../providers/types.js";
import { getLogger } from "../log.js";
import { DEFAULT_SCOUT_DIR } from "../paths.js";
import { resolveExclusivePlugins } from "../engine/plugins/exclusive.js";

export type AddOptions = {
  settings?: string;
};

export async function addCommand(options: AddOptions): Promise<void> {
  intro("gram add");

  const settingsPath = path.resolve(options.settings ?? DEFAULT_SETTINGS_PATH);
  const settings = await readSettingsFile(settingsPath);
  const dataDir = path.resolve(settings.engine?.dataDir ?? DEFAULT_SCOUT_DIR);
  const authStore = new AuthStore(path.join(dataDir, "auth.json"));

  const addTarget = await promptSelect({
    message: "What do you want to add?",
    choices: [
      { value: "provider", name: "Provider" },
      { value: "plugin", name: "Plugin" }
    ]
  });

  if (addTarget === null) {
    outro("Cancelled.");
    return;
  }

  if (addTarget === "plugin") {
    await addPlugin(settingsPath, settings, dataDir, authStore);
    return;
  }

  await addProvider(settingsPath, dataDir, authStore);
}

async function addPlugin(
  settingsPath: string,
  settings: Awaited<ReturnType<typeof readSettingsFile>>,
  dataDir: string,
  authStore: AuthStore
): Promise<void> {
  const catalog = buildPluginCatalog();
  const plugins = Array.from(catalog.values());

  if (plugins.length === 0) {
    outro("No plugins available.");
    return;
  }

  const sortedPlugins = sortPlugins(plugins);
  const pluginId = await promptSelect({
    message: "Select a plugin",
    choices: sortedPlugins.map((entry) => ({
      value: entry.descriptor.id,
      name: entry.descriptor.name,
      description: entry.descriptor.description
    }))
  });

  if (pluginId === null) {
    outro("Cancelled.");
    return;
  }

  const definition = catalog.get(pluginId);
  if (!definition) {
    outro("Unknown plugin selection.");
    return;
  }

  const instanceId = nextPluginInstanceId(pluginId, settings.plugins);
  let settingsConfig: Record<string, unknown> = {};

  const exclusiveCheck = resolveExclusivePlugins(
    listEnabledPlugins({
      ...settings,
      plugins: upsertPlugin(settings.plugins, {
        instanceId,
        pluginId,
        enabled: true
      })
    }),
    catalog
  );

  if (exclusiveCheck.skipped.length > 0) {
    const exclusiveId = exclusiveCheck.exclusive?.pluginId;
    const exclusiveName =
      (exclusiveId && catalog.get(exclusiveId)?.descriptor.name) ?? exclusiveId ?? "Exclusive plugin";
    outro(
      `Cannot enable ${definition.descriptor.name}. ${exclusiveName} is marked exclusive, so only one plugin can be enabled at a time.`
    );
    return;
  }

  const loader = new PluginModuleLoader(`onboarding:${instanceId}`);
  const { module } = await loader.load(definition.entryPath);
  if (module.onboarding) {
    const prompts = createPromptHelpers();
    const result = await module.onboarding({
      instanceId,
      pluginId,
      auth: authStore,
      prompt: prompts,
      note
    });
    if (result === null) {
      outro("Cancelled.");
      return;
    }
    settingsConfig = result.settings ?? {};
  } else {
    note("No onboarding flow provided; using default settings.", "Plugin");
  }

  try {
    await validatePluginLoad(
      settings,
      dataDir,
      authStore,
      {
        instanceId,
        pluginId,
        enabled: true,
        settings: settingsConfig
      }
    );
  } catch (error) {
    outro(`Plugin failed to load: ${(error as Error).message}`);
    return;
  }

  await updateSettingsFile(settingsPath, (current) => {
    const nextSettings =
      Object.keys(settingsConfig).length > 0 ? settingsConfig : undefined;
    return {
      ...current,
      plugins: upsertPlugin(current.plugins, {
        instanceId,
        pluginId,
        enabled: true,
        settings: nextSettings
      })
    };
  });

  outro(
    `Added ${definition.descriptor.name} (${instanceId}). Restart the engine to apply changes.`
  );
}

async function addProvider(
  settingsPath: string,
  dataDir: string,
  authStore: AuthStore
): Promise<void> {
  const providers = listProviderDefinitions();
  if (providers.length === 0) {
    outro("No providers available.");
    return;
  }

  const providerId = await promptSelect({
    message: "Select a provider",
    choices: providers.map((provider) => ({
      value: provider.id,
      name: provider.name,
      description: provider.description
    }))
  });

  if (providerId === null) {
    outro("Cancelled.");
    return;
  }

  const definition = getProviderDefinition(providerId);
  if (!definition) {
    outro("Unknown provider selection.");
    return;
  }

  const result = await runProviderOnboarding(definition, authStore);
  if (result === null) {
    outro("Cancelled.");
    return;
  }

  const providerSettings: ProviderSettings = {
    id: definition.id,
    enabled: true,
    ...(result.settings ?? {})
  };

  try {
    await validateProviderLoad(dataDir, authStore, definition, providerSettings);
  } catch (error) {
    outro(`Provider failed to load: ${(error as Error).message}`);
    return;
  }

  await updateSettingsFile(settingsPath, (current) => {
    const nextProviders = upsertProviderSettings(listProviders(current), providerSettings);
    return {
      ...current,
      providers: nextProviders
    };
  });

  outro(`Added ${definition.name}. Restart the engine to apply changes.`);
}


function createPromptHelpers() {
  return {
    input: promptInput,
    confirm: promptConfirm,
    select: promptSelect
  };
}

async function validatePluginLoad(
  settings: Awaited<ReturnType<typeof readSettingsFile>>,
  dataDir: string,
  authStore: AuthStore,
  pluginConfig: PluginInstanceSettings
): Promise<void> {
  const connectorRegistry = new ConnectorRegistry({
    onMessage: async () => undefined,
    onFatal: () => undefined
  });
  const inferenceRegistry = new InferenceRegistry();
  const imageRegistry = new ImageGenerationRegistry();
  const toolRegistry = new ToolResolver();
  const pluginRegistry = new PluginRegistry(
    connectorRegistry,
    inferenceRegistry,
    imageRegistry,
    toolRegistry
  );
  const pluginEventQueue = new PluginEventQueue();
  const fileStore = new FileStore({ basePath: `${dataDir}/files` });
  const inferenceRouter = new InferenceRouter({
    providers: listActiveInferenceProviders(settings),
    registry: inferenceRegistry,
    auth: authStore
  });
  const pluginManager = new PluginManager({
    settings,
    registry: pluginRegistry,
    auth: authStore,
    fileStore,
    pluginCatalog: buildPluginCatalog(),
    dataDir,
    eventQueue: pluginEventQueue,
    inferenceRouter,
    mode: "validate"
  });

  await pluginManager.load(pluginConfig);
  try {
    await pluginManager.unload(pluginConfig.instanceId);
  } catch (error) {
    note(`Plugin validation unload failed: ${(error as Error).message}`, "Plugin");
  }
}

async function runProviderOnboarding(
  definition: ProviderDefinition,
  authStore: AuthStore
) {
  if (!definition.onboarding) {
    return { settings: {} };
  }
  const prompts = createPromptHelpers();
  const result = await definition.onboarding({
    id: definition.id,
    auth: authStore,
    prompt: prompts,
    note
  });
  return result ?? null;
}

async function validateProviderLoad(
  dataDir: string,
  authStore: AuthStore,
  definition: ProviderDefinition,
  providerSettings: ProviderSettings
) {
  const inferenceRegistry = new InferenceRegistry();
  const imageRegistry = new ImageGenerationRegistry();
  const fileStore = new FileStore({ basePath: `${dataDir}/files` });
  const logger = getLogger(`provider.validate.${definition.id}`);
  const instance = await Promise.resolve(
    definition.create({
      settings: providerSettings,
      auth: authStore,
      fileStore,
      inferenceRegistry,
      imageRegistry,
      logger
    })
  );
  await instance.load?.();
  try {
    await instance.unload?.();
  } catch (error) {
    note(`Provider validation unload failed: ${(error as Error).message}`, "Provider");
  }
}

function sortPlugins(plugins: PluginDefinition[]) {
  return [...plugins].sort((a, b) => a.descriptor.name.localeCompare(b.descriptor.name));
}

function intro(message: string): void {
  console.log(message);
}

function outro(message: string): void {
  console.log(message);
}

function note(message: string, title?: string): void {
  if (title) {
    console.log(`${title}: ${message}`);
    return;
  }
  console.log(message);
}
