import { z } from "zod";

import { definePlugin } from "./types.js";

type OpenAiImageResponse = {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
};

const settingsSchema = z
  .object({
    model: z.string().optional(),
    size: z.string().optional(),
    quality: z.enum(["standard", "hd"]).optional()
  })
  .passthrough();

export const plugin = definePlugin({
  settingsSchema,
  create: (api) => {
    const providerId = api.instance.instanceId;
    return {
      load: async () => {
        api.registrar.registerImageProvider({
          id: providerId,
          label: providerId,
          generate: async (request, generationContext) => {
            const apiKey = await generationContext.secrets.get(providerId, "apiKey");
            if (!apiKey) {
              throw new Error("Missing gpt-image apiKey in secrets store");
            }
            const config = api.settings;
            const payload: Record<string, unknown> = {
              prompt: request.prompt,
              model: config.model ?? request.model ?? "gpt-image-1",
              size: request.size ?? config.size ?? "1024x1024",
              n: request.count ?? 1,
              response_format: "b64_json"
            };
            if (config.quality) {
              payload.quality = config.quality;
            }
            const response = await fetch("https://api.openai.com/v1/images/generations", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`
              },
              body: JSON.stringify(payload)
            });
            if (!response.ok) {
              throw new Error(`OpenAI image generation failed: ${response.status}`);
            }
            const data = (await response.json()) as OpenAiImageResponse;
            const items = data.data ?? [];
            const files = [];
            for (let index = 0; index < items.length; index += 1) {
              const entry = items[index];
              if (!entry) {
                continue;
              }
              const base64 = entry.b64_json;
              if (!base64) {
                continue;
              }
              const buffer = Buffer.from(base64, "base64");
              const stored = await generationContext.fileStore.saveBuffer({
                name: `gpt-image-${Date.now()}-${index + 1}.png`,
                mimeType: "image/png",
                data: buffer,
                source: providerId
              });
              files.push({
                id: stored.id,
                name: stored.name,
                mimeType: stored.mimeType,
                size: stored.size,
                path: stored.path
              });
            }
            return { files };
          }
        });
      },
      unload: async () => {
        api.registrar.unregisterImageProvider(providerId);
      }
    };
  }
});
