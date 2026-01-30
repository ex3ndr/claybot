import {
  complete,
  getModel,
  getModels,
  stream,
  type Api,
  type Model
} from "@mariozechner/pi-ai";
import { z } from "zod";

import { definePlugin } from "../engine/plugins/types.js";

const settingsSchema = z.object({}).passthrough();

export const plugin = definePlugin({
  settingsSchema,
  create: (api) => {
    return {
      load: async () => {
        const providerId = api.instance.instanceId;
        api.registrar.registerInferenceProvider({
          id: providerId,
          label: api.instance.instanceId,
          createClient: async (options) => {
            const apiKey = await api.auth.getApiKey(providerId);
            if (!apiKey) {
              throw new Error("Missing openai-codex apiKey in auth store");
            }
            const modelId = resolveModelId("openai-codex", options.model);
            const model = getModel("openai-codex", modelId as never);
            if (!model) {
              throw new Error(`Unknown openai-codex model: ${modelId}`);
            }
            return {
              modelId: model.id,
              complete: (ctx, runtimeOptions) =>
                complete(model as Model<Api>, ctx, {
                  ...options.config,
                  ...runtimeOptions,
                  apiKey: runtimeOptions?.apiKey ?? apiKey
                }),
              stream: (ctx, runtimeOptions) =>
                stream(model as Model<Api>, ctx, {
                  ...options.config,
                  ...runtimeOptions,
                  apiKey: runtimeOptions?.apiKey ?? apiKey
                })
            };
          }
        });
      },
      unload: async () => {
        api.registrar.unregisterInferenceProvider(api.instance.instanceId);
      }
    };
  }
});

function resolveModelId(provider: "openai-codex", preferred?: string): string {
  const models = getModels(provider);
  if (models.length === 0) {
    throw new Error(`No models available for provider ${provider}`);
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
