import path from "node:path";

import { createId } from "@paralleldrive/cuid2";

import { AuthStore } from "../auth/store.js";
import { promptConfirm, promptInput, promptSelect } from "./prompts.js";
import { ConnectorRegistry, ImageGenerationRegistry, InferenceRegistry, ToolResolver } from "../engine/modules.js";
import { FileStore } from "../files/store.js";
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
  type InferenceProviderSettings,
  type PluginInstanceSettings
} from "../settings.js";

export type AddOptions = {
  settings?: string;
};

export async function addCommand(options: AddOptions): Promise<void> {
  intro("gram add");

  const settingsPath = path.resolve(options.settings ?? DEFAULT_SETTINGS_PATH);
  const settings = await readSettingsFile(settingsPath);
  const dataDir = path.resolve(settings.engine?.dataDir ?? ".scout");
  const authStore = new AuthStore(path.join(dataDir, "auth.json"));

  const addTarget = await promptSelect({
    message: "What do you want to add?",
    choices: [
      { value: "provider", name: "Inference provider" },
      { value: "plugin", name: "Plugin" }
    ]
  });

  if (addTarget === null) {
    outro("Cancelled.");
    return;
  }

  if (addTarget === "plugin") {
    await addPlugin(settingsPath, settings, dataDir, authStore, "plugin");
    return;
  }

  await addPlugin(settingsPath, settings, dataDir, authStore, "provider");
}

async function addPlugin(
  settingsPath: string,
  settings: Awaited<ReturnType<typeof readSettingsFile>>,
  dataDir: string,
  authStore: AuthStore,
  kind: "provider" | "plugin"
): Promise<void> {
  const catalog = buildPluginCatalog();
  const plugins = Array.from(catalog.values()).filter((entry) => {
    const isProvider = entry.pluginDir.includes(`${path.sep}plugins${path.sep}providers${path.sep}`);
    return kind === "provider" ? isProvider : !isProvider;
  });

  if (plugins.length === 0) {
    outro(kind === "provider" ? "No providers available." : "No plugins available.");
    return;
  }

  const sortedPlugins = sortPlugins(plugins, kind);
  const pluginId = await promptSelect({
    message: kind === "provider" ? "Select a provider" : "Select a plugin",
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

  const instanceId = createId();
  let settingsConfig: Record<string, unknown> = {};
  let inferenceConfig: InferenceProviderSettings | null = null;

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
    inferenceConfig = result.inference ?? null;
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
      }),
      inference: inferenceConfig
        ? {
            ...(current.inference ?? {}),
            providers: upsertProvider(current.inference?.providers ?? [], inferenceConfig)
          }
        : current.inference
    };
  });

  outro(
    `Added ${definition.descriptor.name} (${instanceId}). Restart the engine to apply changes.`
  );
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
  const pluginManager = new PluginManager({
    settings,
    registry: pluginRegistry,
    auth: authStore,
    fileStore,
    pluginCatalog: buildPluginCatalog(),
    dataDir,
    eventQueue: pluginEventQueue,
    mode: "validate"
  });

  await pluginManager.load(pluginConfig);
  try {
    await pluginManager.unload(pluginConfig.instanceId);
  } catch (error) {
    note(`Plugin validation unload failed: ${(error as Error).message}`, "Plugin");
  }
}

function upsertProvider(
  providers: InferenceProviderSettings[],
  entry: InferenceProviderSettings
): InferenceProviderSettings[] {
  const filtered = providers.filter((provider) => provider.id !== entry.id);
  return [entry, ...filtered];
}

function sortPlugins(plugins: PluginDefinition[], kind: "provider" | "plugin") {
  if (kind !== "provider") {
    return [...plugins].sort((a, b) => a.descriptor.name.localeCompare(b.descriptor.name));
  }

  const popularity = [
    "openai",
    "openai-compatible",
    "anthropic",
    "google",
    "openrouter",
    "groq",
    "mistral",
    "xai",
    "azure-openai-responses",
    "github-copilot",
    "openai-codex",
    "google-gemini-cli",
    "google-antigravity",
    "amazon-bedrock",
    "google-vertex",
    "vercel-ai-gateway",
    "cerebras",
    "minimax",
    "kimi-coding"
  ];
  const rank = new Map(popularity.map((id, index) => [id, index]));

  return [...plugins].sort((a, b) => {
    const rankA = rank.get(a.descriptor.id);
    const rankB = rank.get(b.descriptor.id);
    if (rankA !== undefined || rankB !== undefined) {
      const aValue = rankA ?? Number.MAX_SAFE_INTEGER;
      const bValue = rankB ?? Number.MAX_SAFE_INTEGER;
      if (aValue !== bValue) {
        return aValue - bValue;
      }
    }
    return a.descriptor.name.localeCompare(b.descriptor.name);
  });
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
