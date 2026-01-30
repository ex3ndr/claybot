import { complete, stream, type Api, type Model } from "@mariozechner/pi-ai";
import { z } from "zod";

import { definePlugin } from "../engine/plugins/types.js";

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

export const plugin = definePlugin({
  settingsSchema,
  create: (api) => {
    const providerId = api.instance.instanceId;
    return {
      load: async () => {
        api.registrar.registerInferenceProvider({
          id: providerId,
          label: providerId,
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
