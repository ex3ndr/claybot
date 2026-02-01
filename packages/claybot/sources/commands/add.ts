import path from "node:path";

import { AuthStore } from "../auth/store.js";
import { promptConfirm, promptInput, promptSelect } from "./prompts.js";
import { ConnectorRegistry } from "../engine/modules/connectorRegistry.js";
import { ImageGenerationRegistry } from "../engine/modules/imageGenerationRegistry.js";
import { InferenceRegistry } from "../engine/modules/inferenceRegistry.js";
import { ToolResolver } from "../engine/modules/toolResolver.js";
import { FileStore } from "../files/store.js";
import { InferenceRouter } from "../engine/modules/inference/router.js";
import { PluginManager } from "../engine/plugins/manager.js";
import { buildPluginCatalog, type PluginDefinition } from "../engine/plugins/catalog.js";
import { PluginEventQueue } from "../engine/plugins/events.js";
import { PluginRegistry } from "../engine/plugins/registry.js";
import { PluginModuleLoader } from "../engine/plugins/loader.js";
import {
  DEFAULT_SETTINGS_PATH,
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
import { resolveExclusivePlugins } from "../engine/plugins/exclusive.js";
import { configLoad } from "../config/configLoad.js";
import type { Config } from "@/types";
import { engineReloadRequest } from "./engineReloadRequest.js";

export type AddOptions = {
  settings?: string;
};

export async function addCommand(options: AddOptions): Promise<void> {
  intro("claybot add");

  const settingsPath = path.resolve(options.settings ?? DEFAULT_SETTINGS_PATH);
  const config = await configLoad(settingsPath);
  const settings = config.settings;
  const authStore = new AuthStore(config);

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
    await addPlugin(settingsPath, config, authStore);
    return;
  }

  await addProvider(settingsPath, config, authStore);
}

async function addPlugin(
  settingsPath: string,
  config: Config,
  authStore: AuthStore
): Promise<void> {
  const settings = config.settings;
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

  const instanceId = nextPluginInstanceId(pluginId, settings.plugins, {
    exclusive: definition.descriptor.exclusive
  });
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
      config,
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

  const reloaded = await engineReloadRequest(settingsPath);
  outro(
    reloaded
      ? `Added ${definition.descriptor.name} (${instanceId}). Reloaded engine.`
      : `Added ${definition.descriptor.name} (${instanceId}). Restart the engine to apply changes.`
  );
}

async function addProvider(
  settingsPath: string,
  config: Config,
  authStore: AuthStore
): Promise<void> {
  const providers = listProviderDefinitions();
  if (providers.length === 0) {
    outro("No providers available.");
    return;
  }

  const providerId = await promptSelect({
    message: "Select a provider",
    choices: buildProviderChoices(providers)
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
    await validateProviderLoad(config, authStore, definition, providerSettings);
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

  const reloaded = await engineReloadRequest(settingsPath);
  outro(
    reloaded
      ? `Added ${definition.name}. Reloaded engine.`
      : `Added ${definition.name}. Restart the engine to apply changes.`
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
  config: Awaited<ReturnType<typeof configLoad>>,
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
  const fileStore = new FileStore(config);
  const inferenceRouter = new InferenceRouter({
    providers: listActiveInferenceProviders(config.settings),
    registry: inferenceRegistry,
    auth: authStore
  });
  const pluginManager = new PluginManager({
    config,
    registry: pluginRegistry,
    auth: authStore,
    fileStore,
    pluginCatalog: buildPluginCatalog(),
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
  config: Config,
  authStore: AuthStore,
  definition: ProviderDefinition,
  providerSettings: ProviderSettings
) {
  const inferenceRegistry = new InferenceRegistry();
  const imageRegistry = new ImageGenerationRegistry();
  const fileStore = new FileStore(config);
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

type ProviderSectionId = "subscriptions" | "apiKeys" | "cloud" | "custom";

const PROVIDER_SECTIONS: Array<{
  id: ProviderSectionId;
  title: string;
  description: string;
}> = [
  {
    id: "subscriptions",
    title: "Subscriptions (sign in)",
    description: "Use OAuth sign-in for subscription-based access."
  },
  {
    id: "apiKeys",
    title: "API keys",
    description: "Bring your own API key."
  },
  {
    id: "cloud",
    title: "Cloud (Vertex AI, Bedrock)",
    description: "Managed cloud provider integrations."
  },
  {
    id: "custom",
    title: "Custom / self-hosted",
    description: "Custom endpoints and image backends."
  }
];

const PROVIDER_SECTION_OVERRIDES: Record<string, ProviderSectionId> = {
  "amazon-bedrock": "cloud",
  "google-vertex": "cloud",
  "openai-compatible": "custom",
  nanobanana: "custom"
};

const SUBSCRIPTION_PRIORITY = ["anthropic", "openai-codex"];

const POPULARITY_ORDER = [
  "anthropic",
  "openai-codex",
  "openai",
  "openrouter",
  "google",
  "azure-openai-responses",
  "groq",
  "mistral",
  "xai",
  "github-copilot",
  "google-gemini-cli",
  "amazon-bedrock",
  "google-vertex",
  "vercel-ai-gateway",
  "cerebras",
  "minimax",
  "kimi-coding",
  "openai-compatible",
  "nanobanana",
  "google-antigravity"
];

const FRIENDLY_LABELS: Record<string, { name?: string; description?: string }> = {
  anthropic: {
    name: "Anthropic (subscription sign-in)",
    description: "Sign in with OAuth or use an API key."
  },
  "openai-codex": {
    name: "OpenAI Codex (sign in)",
    description: "Sign in with OAuth to use Codex."
  },
  "openai-compatible": {
    name: "OpenAI-compatible (custom endpoint)",
    description: "Bring your own base URL and model."
  },
  "amazon-bedrock": {
    description: "AWS-managed models via Bedrock."
  },
  "google-vertex": {
    description: "GCP-managed models via Vertex AI."
  }
};

function buildProviderChoices(providers: ProviderDefinition[]) {
  const grouped = new Map<ProviderSectionId, ProviderDefinition[]>();
  for (const provider of providers) {
    const section = resolveProviderSection(provider);
    const list = grouped.get(section) ?? [];
    list.push(provider);
    grouped.set(section, list);
  }

  const choices: Array<{
    value: string;
    name: string;
    description?: string;
    disabled?: boolean;
  }> = [];

  for (const section of PROVIDER_SECTIONS) {
    const entries = grouped.get(section.id);
    if (!entries || entries.length === 0) {
      continue;
    }
    choices.push({
      value: `__section:${section.id}`,
      name: section.title,
      description: section.description,
      disabled: true
    });
    const sorted = [...entries].sort((a, b) => compareProviders(a, b, section.id));
    for (const provider of sorted) {
      const friendly = FRIENDLY_LABELS[provider.id] ?? {};
      choices.push({
        value: provider.id,
        name: friendly.name ?? provider.name,
        description: friendly.description ?? provider.description
      });
    }
  }

  return choices;
}

function resolveProviderSection(provider: ProviderDefinition): ProviderSectionId {
  const override = PROVIDER_SECTION_OVERRIDES[provider.id];
  if (override) {
    return override;
  }
  if (provider.auth === "oauth" || provider.auth === "mixed") {
    return "subscriptions";
  }
  return "apiKeys";
}

function compareProviders(
  a: ProviderDefinition,
  b: ProviderDefinition,
  section: ProviderSectionId
): number {
  const priorityA = resolvePriority(a, section);
  const priorityB = resolvePriority(b, section);
  if (priorityA !== priorityB) {
    return priorityA - priorityB;
  }
  const popularityA = resolvePopularityRank(a.id);
  const popularityB = resolvePopularityRank(b.id);
  if (popularityA !== popularityB) {
    return popularityA - popularityB;
  }
  return a.name.localeCompare(b.name);
}

function resolvePriority(provider: ProviderDefinition, section: ProviderSectionId): number {
  if (section !== "subscriptions") {
    return 0;
  }
  const index = SUBSCRIPTION_PRIORITY.indexOf(provider.id);
  return index === -1 ? SUBSCRIPTION_PRIORITY.length : index;
}

function resolvePopularityRank(providerId: string): number {
  const index = POPULARITY_ORDER.indexOf(providerId);
  return index === -1 ? POPULARITY_ORDER.length : index;
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
