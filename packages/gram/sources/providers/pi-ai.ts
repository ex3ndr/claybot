import {
  complete,
  getModel,
  getModels,
  getOAuthApiKey,
  getOAuthProvider,
  stream,
  type Api,
  type Model,
  type OAuthCredentials,
  type OAuthProviderId
} from "@mariozechner/pi-ai";

import type { AuthStore } from "../auth/store.js";
import type { ProviderSettings } from "../settings.js";
import type { ProviderDefinition, ProviderAuth, ProviderContext, ProviderOnboardingApi } from "./types.js";
import type { ImageGenerationProvider } from "../engine/images/types.js";

export type PiAiProviderConfig = {
  id: string;
  name: string;
  description: string;
  auth: ProviderAuth;
  optionalApiKey?: boolean;
  imageProvider?: (context: ProviderContext) => ImageGenerationProvider;
};

export function createPiAiProviderDefinition(config: PiAiProviderConfig): ProviderDefinition {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    auth: config.auth,
    capabilities: {
      inference: true,
      image: Boolean(config.imageProvider)
    },
    create: (context) => ({
      load: async () => {
        context.inferenceRegistry.register(config.id, {
          id: config.id,
          label: config.name,
          createClient: async (options) => {
            const modelId = resolveModelId(config.id, options.model);
            const model = getModel(config.id as never, modelId as never);
            if (!model) {
              throw new Error(`Unknown ${config.id} model: ${modelId}`);
            }
            const apiKey = await resolveApiKey(config, options.auth);
            return {
              modelId: model.id,
              complete: (ctx, runtimeOptions) =>
                complete(model as Model<Api>, ctx, buildOptions(apiKey, options.config, runtimeOptions)),
              stream: (ctx, runtimeOptions) =>
                stream(model as Model<Api>, ctx, buildOptions(apiKey, options.config, runtimeOptions))
            };
          }
        });

        if (config.imageProvider) {
          const provider = config.imageProvider(context);
          const enabled = context.settings.image?.enabled ?? true;
          if (enabled) {
            context.imageRegistry.register(config.id, provider);
          }
        }
      },
      unload: async () => {
        context.inferenceRegistry.unregister(config.id);
        if (config.imageProvider) {
          context.imageRegistry.unregister(config.id);
        }
      }
    }),
    onboarding: async (api) => runPiAiOnboarding(config, api)
  };
}

async function runPiAiOnboarding(
  config: PiAiProviderConfig,
  api: ProviderOnboardingApi
) {
  const authMode = await resolveAuthMode(config, api.auth, api.prompt);
  if (!authMode) {
    return null;
  }

  if (authMode === "oauth") {
    try {
      const credentials = await runOAuthLogin(config.id as OAuthProviderId, api);
      if (!credentials) {
        return null;
      }
      await api.auth.setOAuth(config.id, credentials as Record<string, unknown>);
    } catch (error) {
      if (error instanceof Error && error.message === "OAuth login cancelled") {
        return null;
      }
      throw error;
    }
  }

  if (authMode === "apiKey") {
    const existing = await api.auth.getApiKey(config.id);
    if (!existing) {
      const apiKey = await api.prompt.input({
        message: config.optionalApiKey ? "API key (optional)" : "API key"
      });
      if (apiKey === null) {
        return null;
      }
      if (apiKey || !config.optionalApiKey) {
        if (!apiKey && !config.optionalApiKey) {
          api.note("API key is required to continue.", config.name);
          return null;
        }
        if (apiKey) {
          await api.auth.setApiKey(config.id, apiKey);
        }
      }
    }
  }

  const defaultModel = pickDefaultModel(config.id);
  if (!defaultModel) {
    api.note("No models available for this provider.", config.name);
    return null;
  }
  api.note(`Default model set to ${defaultModel.id}.`, config.name);

  return {
    settings: {
      model: defaultModel.id
    } satisfies Partial<ProviderSettings>
  };
}

function resolveModelId(providerId: string, preferred?: string): string {
  const models = getSortedModels(providerId);
  if (models.length === 0) {
    throw new Error(`No models available for provider ${providerId}`);
  }

  if (preferred) {
    const match = models.find((model) => model.id === preferred);
    if (match) {
      return match.id;
    }
  }

  const fallback =
    models.find((model) => model.id.endsWith("-latest")) ??
    models.find((model) => model.id.includes("latest")) ??
    models[0];
  return fallback!.id;
}

function pickDefaultModel(providerId: string): Model<Api> | null {
  const models = getSortedModels(providerId);
  return models[0] ?? null;
}

function getSortedModels(providerId: string): Model<Api>[] {
  const models = getModels(providerId as never) as Model<Api>[];
  return [...models].sort(compareModels);
}

function compareModels(a: Model<Api>, b: Model<Api>): number {
  if (a.reasoning !== b.reasoning) {
    return a.reasoning ? -1 : 1;
  }
  const tierA = modelTier(a);
  const tierB = modelTier(b);
  if (tierA !== tierB) {
    return tierB - tierA;
  }
  if (a.contextWindow !== b.contextWindow) {
    return b.contextWindow - a.contextWindow;
  }
  if (a.maxTokens !== b.maxTokens) {
    return b.maxTokens - a.maxTokens;
  }
  const dateA = parseDateScore(a);
  const dateB = parseDateScore(b);
  if (dateA !== dateB) {
    return dateB - dateA;
  }
  return a.id.localeCompare(b.id);
}

function modelTier(model: Model<Api>): number {
  const name = `${model.id} ${model.name}`.toLowerCase();
  let score = 0;
  if (/(opus|ultra|pro|max|xlarge|xl|plus)/.test(name)) {
    score += 2;
  }
  if (/(medium|standard)/.test(name)) {
    score += 1;
  }
  if (/(mini|small|lite|tiny|nano)/.test(name)) {
    score -= 2;
  }
  return score;
}

function parseDateScore(model: Model<Api>): number {
  const value = `${model.id} ${model.name}`;
  if (/latest/i.test(value)) {
    return 99999999;
  }
  const match = value.match(/(20\\d{2})[-_/]?(\\d{2})(?:[-_/]?(\\d{2}))?/);
  if (!match) {
    return 0;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3] ?? "01");
  if (!year || !month) {
    return 0;
  }
  return year * 10000 + month * 100 + day;
}

function buildOptions(
  apiKey: string | null,
  config?: Record<string, unknown>,
  runtimeOptions?: Record<string, unknown>
): Record<string, unknown> {
  const merged = {
    ...(config ?? {}),
    ...(runtimeOptions ?? {})
  };
  if (apiKey) {
    merged.apiKey = (runtimeOptions as { apiKey?: string } | undefined)?.apiKey ?? apiKey;
  }
  return merged;
}

async function resolveApiKey(
  provider: PiAiProviderConfig,
  auth: AuthStore
): Promise<string | null> {
  if (provider.auth === "none") {
    return null;
  }

  const config = await auth.read();
  const entry = config[provider.id] ?? null;
  const needsOAuth = provider.auth === "oauth";
  const allowOAuth = provider.auth === "oauth" || provider.auth === "mixed";

  if (allowOAuth && entry?.type === "oauth") {
    const credentials = stripOAuth(entry);
    const result = await getOAuthApiKey(provider.id as OAuthProviderId, {
      [provider.id]: credentials
    });
    if (!result) {
      if (needsOAuth) {
        throw new Error(`Missing OAuth credentials for ${provider.id}`);
      }
      return null;
    }
    await auth.setOAuth(provider.id, result.newCredentials as unknown as Record<string, unknown>);
    return result.apiKey;
  }

  const apiKey = entry?.apiKey ?? null;
  if (!apiKey && needsOAuth) {
    throw new Error(`Missing OAuth credentials for ${provider.id}`);
  }
  if (!apiKey && provider.auth === "apiKey" && !provider.optionalApiKey) {
    throw new Error(`Missing ${provider.id} apiKey in auth store`);
  }
  return apiKey;
}

function stripOAuth(entry: Record<string, unknown>): OAuthCredentials {
  const { type: _type, ...rest } = entry;
  return rest as OAuthCredentials;
}

async function resolveAuthMode(
  provider: PiAiProviderConfig,
  auth: AuthStore,
  prompt: ProviderOnboardingApi["prompt"]
): Promise<"oauth" | "apiKey" | "none" | null> {
  if (provider.auth === "none") {
    return "none";
  }
  if (provider.auth === "oauth") {
    return "oauth";
  }
  if (provider.auth === "apiKey") {
    return "apiKey";
  }

  const existing = await auth.getEntry(provider.id);
  if (existing?.type === "oauth") {
    return "oauth";
  }
  if (existing?.apiKey) {
    return "apiKey";
  }

  const useOAuth = await prompt.confirm({
    message: "Sign in with OAuth instead of an API key?",
    default: true
  });
  if (useOAuth === null) {
    return null;
  }
  return useOAuth ? "oauth" : "apiKey";
}

async function runOAuthLogin(
  providerId: OAuthProviderId,
  api: ProviderOnboardingApi
): Promise<Record<string, unknown> | null> {
  const provider = getOAuthProvider(providerId);
  if (!provider) {
    throw new Error(`OAuth login not supported for ${providerId}`);
  }

  return provider.login({
    onAuth: (info) => {
      api.note(`Open ${info.url}`, "OAuth");
      if (info.instructions) {
        api.note(info.instructions, "OAuth");
      }
    },
    onPrompt: async (question) => {
      const response = await api.prompt.input({ message: question.message });
      if (response === null) {
        throw new Error("OAuth login cancelled");
      }
      return response;
    },
    onProgress: (message) => {
      api.note(message, "OAuth");
    }
  });
}
