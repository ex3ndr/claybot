import { createId } from "@paralleldrive/cuid2";
import type { AssistantMessage, Context } from "@mariozechner/pi-ai";

import { getLogger } from "../../log.js";
import { getProviderDefinition, listActiveInferenceProviders } from "../../providers/catalog.js";
import type { ProviderModelInfo, ProviderModelSize } from "../../providers/types.js";
import type { ProviderSettings, SettingsConfig } from "../../settings.js";
import type { InferenceRouter } from "../inference/router.js";

export type PluginInferenceStrategy = "default" | "small" | "normal" | "large";

export type PluginInferenceRequest = {
  systemPrompt?: string;
  messages: Context["messages"];
  providerId?: string;
  strategy?: PluginInferenceStrategy;
};

export type PluginInferenceResult = {
  message: AssistantMessage;
  providerId: string;
  modelId: string;
};

export type PluginInference = {
  complete: (request: PluginInferenceRequest) => Promise<PluginInferenceResult>;
};

type PluginInferenceServiceOptions = {
  router: InferenceRouter;
  getSettings: () => SettingsConfig;
};

const logger = getLogger("plugins.inference");

export class PluginInferenceService {
  private router: InferenceRouter;
  private getSettings: () => SettingsConfig;

  constructor(options: PluginInferenceServiceOptions) {
    this.router = options.router;
    this.getSettings = options.getSettings;
  }

  createClient(instanceId: string): PluginInference {
    return {
      complete: async (request) => this.complete(request, instanceId)
    };
  }

  private async complete(
    request: PluginInferenceRequest,
    instanceId: string
  ): Promise<PluginInferenceResult> {
    const settings = this.getSettings();
    const providers = listActiveInferenceProviders(settings);
    if (providers.length === 0) {
      throw new Error("No inference provider available");
    }

    const strategy = request.strategy ?? "default";
    const context: Context = {
      messages: request.messages,
      systemPrompt: request.systemPrompt
    };
    const sessionId = `plugin:${instanceId}:${createId()}`;

    if (strategy === "default") {
      const providersOverride = resolveProvidersOverride(providers, request.providerId);
      return this.router.complete(context, sessionId, {
        providersOverride
      });
    }

    const provider = resolveSelectedProvider(providers, request.providerId);
    const resolvedModel = resolveModelForStrategy(provider.id, provider.model, strategy);
    const providersOverride = [
      {
        ...provider,
        model: resolvedModel ?? provider.model
      }
    ];
    logger.debug(
      `Plugin inference selection providerId=${provider.id} strategy=${strategy} model=${providersOverride[0]?.model ?? "default"}`
    );
    return this.router.complete(context, sessionId, {
      providersOverride
    });
  }
}

function resolveProvidersOverride(
  providers: ProviderSettings[],
  providerId?: string
): ProviderSettings[] | undefined {
  if (!providerId) {
    return providers;
  }
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider) {
    throw new Error(`Unknown inference provider: ${providerId}`);
  }
  return [provider];
}

function resolveSelectedProvider(
  providers: ProviderSettings[],
  providerId?: string
): ProviderSettings {
  if (providerId) {
    const provider = providers.find((entry) => entry.id === providerId);
    if (!provider) {
      throw new Error(`Unknown inference provider: ${providerId}`);
    }
    return provider;
  }
  return providers[0]!;
}

function resolveModelForStrategy(
  providerId: string,
  defaultModel: string | undefined,
  strategy: Exclude<PluginInferenceStrategy, "default">
): string | undefined {
  const definition = getProviderDefinition(providerId);
  const models = definition?.models ?? [];
  if (models.length === 0) {
    return defaultModel;
  }

  const order = modelSizeOrder(strategy);
  const match = findModelBySize(models, order);
  if (match) {
    return match.id;
  }

  return defaultModel ?? models[0]?.id;
}

function modelSizeOrder(strategy: Exclude<PluginInferenceStrategy, "default">): ProviderModelSize[] {
  switch (strategy) {
    case "small":
      return ["small", "normal", "large", "unknown"];
    case "normal":
      return ["normal", "large", "small", "unknown"];
    case "large":
      return ["large", "normal", "small", "unknown"];
  }
}

function findModelBySize(
  models: ProviderModelInfo[],
  order: ProviderModelSize[]
): ProviderModelInfo | null {
  for (const size of order) {
    const match = models.find((model) => model.size === size);
    if (match) {
      return match;
    }
  }
  return null;
}
