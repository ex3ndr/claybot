import { complete, stream, type Api, type Model } from "@mariozechner/pi-ai";

import type { ProviderDefinition } from "./types.js";
import type { ProviderSettings } from "../settings.js";

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

export const openAiCompatibleProvider: ProviderDefinition = {
  id: "openai-compatible",
  name: "OpenAI-compatible",
  description: "OpenAI-compatible inference provider.",
  auth: "apiKey",
  capabilities: {
    inference: true
  },
  onboarding: async (api) => {
    const baseUrl = await api.prompt.input({ message: "Base URL" });
    if (baseUrl === null) {
      return null;
    }
    if (!baseUrl) {
      api.note("Base URL is required to continue.", "OpenAI-compatible");
      return null;
    }

    const modelId = await api.prompt.input({ message: "Default model" });
    if (modelId === null) {
      return null;
    }
    if (!modelId) {
      api.note("Model is required to continue.", "OpenAI-compatible");
      return null;
    }

    const apiKey = await api.prompt.input({ message: "API key (optional)" });
    if (apiKey === null) {
      return null;
    }
    if (apiKey) {
      await api.auth.setApiKey(api.id, apiKey);
    }

    return {
      settings: {
        model: modelId,
        options: {
          baseUrl,
          modelId,
          api: inferApi(baseUrl)
        }
      } satisfies Partial<ProviderSettings>
    };
  },
  create: (context) => ({
    load: async () => {
      context.inferenceRegistry.register(context.settings.id, {
        id: context.settings.id,
        label: "OpenAI-compatible",
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

          const apiKey = await options.auth.getApiKey(context.settings.id);

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
      context.inferenceRegistry.unregister(context.settings.id);
    }
  })
};

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
