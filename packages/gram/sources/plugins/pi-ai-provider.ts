import {
  complete,
  getModel,
  getModels,
  getOAuthApiKey,
  stream,
  type Api,
  type Model,
  type OAuthCredentials,
  type OAuthProviderId
} from "@mariozechner/pi-ai";
import { z } from "zod";

import type { AuthStore } from "../auth/store.js";
import { getProviderDefinition, type ProviderDefinition } from "../engine/plugins/providers.js";
import { definePlugin } from "../engine/plugins/types.js";

const settingsSchema = z.object({}).passthrough();

export const plugin = definePlugin({
  settingsSchema,
  create: (api) => {
    const providerId = api.instance.instanceId;
    const provider = getProviderDefinition(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    if (provider.kind !== "pi-ai") {
      throw new Error(`Provider ${providerId} is not a pi-ai provider`);
    }

    return {
      load: async () => {
        api.registrar.registerInferenceProvider({
          id: provider.id,
          label: provider.label,
          createClient: async (options) => {
            const modelId = resolveModelId(provider.id, options.model);
            const model = getModel(provider.id as never, modelId as never);
            if (!model) {
              throw new Error(`Unknown ${provider.id} model: ${modelId}`);
            }
            const apiKey = await resolveApiKey(provider, options.auth);
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
        api.registrar.unregisterInferenceProvider(provider.id);
      }
    };
  }
});

function resolveModelId(providerId: string, preferred?: string): string {
  const models = getModels(providerId as never);
  if (models.length === 0) {
    throw new Error(`No models available for provider ${providerId}`);
  }

  if (preferred) {
    const match = models.find((model) => model.id === preferred);
    if (match) {
      return match.id;
    }
  }

  const latest =
    models.find((model) => model.id.endsWith("-latest")) ??
    models.find((model) => model.id.includes("latest"));
  return latest?.id ?? models[0]!.id;
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
  provider: ProviderDefinition,
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
  if (!apiKey && provider.auth === "apiKey") {
    throw new Error(`Missing ${provider.id} apiKey in auth store`);
  }
  return apiKey;
}

function stripOAuth(entry: Record<string, unknown>): OAuthCredentials {
  const { type: _type, ...rest } = entry;
  return rest as OAuthCredentials;
}
