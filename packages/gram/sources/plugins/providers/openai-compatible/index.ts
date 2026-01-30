import { complete, stream, type Api, type Model } from "@mariozechner/pi-ai";
import { z } from "zod";

import { definePlugin } from "../../../engine/plugins/types.js";

type OpenAiCompatibleConfig = {
  baseUrl?: string;
  api?: "openai-completions" | "openai-responses";
  provider?: string;
  modelId?: string;
  name?: string;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
  compat?: Record<string, unknown>;
  headers?: Record<string, string>;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

const settingsSchema = z.object({}).passthrough();
const providerId = "openai-compatible";
const providerLabel = "OpenAI-compatible";

export const plugin = definePlugin({
  settingsSchema,
  create: (api) => {
    if (api.instance.pluginId !== providerId) {
      throw new Error(`Provider plugin mismatch: expected ${providerId}, got ${api.instance.pluginId}`);
    }
    return {
      load: async () => {
        api.registrar.registerInferenceProvider({
          id: providerId,
          label: providerLabel,
          createClient: async (options) => {
            const config = (options.config ?? {}) as OpenAiCompatibleConfig;
            const modelId = options.model ?? config.modelId ?? null;
            const baseUrl = config.baseUrl ?? null;
            if (!baseUrl) {
              throw new Error("Missing baseUrl for openai-compatible provider");
            }
            if (!modelId) {
              throw new Error("Missing model id for openai-compatible provider");
            }
            const apiType = (config.api ?? "openai-completions") as Api;
            const model: Model<Api> = {
              id: modelId,
              name: config.name ?? modelId,
              api: apiType,
              provider: config.provider ?? "openai-compatible",
              baseUrl,
              reasoning: config.reasoning ?? false,
              input: config.input ?? ["text"],
              cost: config.cost ?? {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0
              },
              contextWindow: config.contextWindow ?? 8192,
              maxTokens: config.maxTokens ?? 2048,
              compat: config.compat,
              headers: config.headers
            };

            const apiKey = await options.auth.getApiKey(providerId);

            return {
              modelId: model.id,
              complete: (ctx, runtimeOptions) =>
                complete(model, ctx, buildOptions(apiKey, options.config, runtimeOptions)),
              stream: (ctx, runtimeOptions) =>
                stream(model, ctx, buildOptions(apiKey, options.config, runtimeOptions))
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
    if (api.pluginId !== providerId) {
      throw new Error(`Provider plugin mismatch: expected ${providerId}, got ${api.pluginId}`);
    }

    const baseUrl = await api.prompt.input({
      message: "Base URL"
    });
    if (baseUrl === null) {
      return null;
    }
    if (!baseUrl) {
      api.note("Base URL is required to continue.", providerLabel);
      return null;
    }

    const modelId = await api.prompt.input({
      message: "Default model"
    });
    if (modelId === null) {
      return null;
    }
    if (!modelId) {
      api.note("Model is required to continue.", providerLabel);
      return null;
    }

    const apiKey = await api.prompt.input({
      message: "API key (optional)"
    });
    if (apiKey === null) {
      return null;
    }
    if (apiKey) {
      await api.auth.setApiKey(providerId, apiKey);
    }

    return {
      inference: {
        id: providerId,
        model: modelId,
        options: {
          baseUrl,
          modelId,
          api: inferApi(baseUrl)
        }
      }
    };
  }
});

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

function inferApi(baseUrl: string): Api {
  const normalized = baseUrl.toLowerCase();
  if (normalized.includes("responses")) {
    return "openai-responses";
  }
  return "openai-completions";
}
