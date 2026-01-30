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
import { z } from "zod";

import type { AuthStore } from "../../../../auth/store.js";
import { definePlugin, type PluginOnboardingResult } from "../../../../engine/plugins/types.js";

const settingsSchema = z.object({}).passthrough();

export type ProviderAuth = "apiKey" | "oauth" | "mixed" | "none";

export type PiAiProviderConfig = {
  id: string;
  label: string;
  auth: ProviderAuth;
  optionalApiKey?: boolean;
};

export function createPiAiProviderPlugin(config: PiAiProviderConfig) {
  return definePlugin({
    settingsSchema,
    create: (api) => {
      const providerId = config.id;
      if (api.instance.pluginId !== providerId) {
        throw new Error(`Provider plugin mismatch: expected ${providerId}, got ${api.instance.pluginId}`);
      }

      return {
        load: async () => {
          api.registrar.registerInferenceProvider({
            id: providerId,
            label: config.label,
            createClient: async (options) => {
              const modelId = resolveModelId(providerId, options.model);
              const model = getModel(providerId as never, modelId as never);
              if (!model) {
                throw new Error(`Unknown ${providerId} model: ${modelId}`);
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
        },
        unload: async () => {
          api.registrar.unregisterInferenceProvider(providerId);
        }
      };
    },
    onboarding: async (api) => {
      if (api.pluginId !== config.id) {
        throw new Error(`Provider plugin mismatch: expected ${config.id}, got ${api.pluginId}`);
      }

      const authMode = await resolveAuthMode(config, api.auth, api.prompt);
      if (!authMode) {
        return null;
      }

      if (authMode === "oauth") {
        try {
          const credentials = await runOAuthLogin(config.id as OAuthProviderId, api.prompt, api.note);
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
              api.note("API key is required to continue.", config.label);
              return null;
            }
            if (apiKey) {
              await api.auth.setApiKey(config.id, apiKey);
            }
          }
        }
      }

      const modelId = await selectDefaultModel(config, api);
      if (!modelId) {
        return null;
      }

      return {
        inference: {
          id: config.id,
          model: modelId
        }
      } satisfies PluginOnboardingResult;
    }
  });
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
  prompt: { confirm: (config: { message: string; default?: boolean }) => Promise<boolean | null> }
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
  prompt: { input: (config: { message: string }) => Promise<string | null> },
  note: (message: string, title?: string) => void
): Promise<Record<string, unknown> | null> {
  const provider = getOAuthProvider(providerId);
  if (!provider) {
    throw new Error(`OAuth login not supported for ${providerId}`);
  }

  return provider.login({
    onAuth: (info) => {
      note(`Open ${info.url}`, "OAuth");
      if (info.instructions) {
        note(info.instructions, "OAuth");
      }
    },
    onPrompt: async (question) => {
      const response = await prompt.input({ message: question.message });
      if (response === null) {
        throw new Error("OAuth login cancelled");
      }
      return response;
    },
    onProgress: (message) => {
      note(message, "OAuth");
    }
  });
}

async function selectDefaultModel(
  config: PiAiProviderConfig,
  api: { prompt: { select: <TValue extends string>(config: { message: string; choices: { value: TValue; name: string; description?: string }[] }) => Promise<TValue | null> }; note: (message: string, title?: string) => void }
): Promise<string | null> {
  const models = getSortedModels(config.id);
  if (models.length === 0) {
    api.note("No models available for this provider.", config.label);
    return null;
  }

  const selection = await api.prompt.select({
    message: "Select a default model",
    choices: models.map((model) => ({
      value: model.id,
      name: model.name || model.id,
      description: model.id
    }))
  });
  return selection;
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
  const match = value.match(/(20\d{2})[-_/]?(\d{2})(?:[-_/]?(\d{2}))?/);
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
