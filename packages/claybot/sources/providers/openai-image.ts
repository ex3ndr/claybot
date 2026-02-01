import type { ImageGenerationProvider } from "@/types";
import type { ProviderContext } from "./types.js";

type OpenAiImageResponse = {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
};

export function buildOpenAiImageProvider(context: ProviderContext): ImageGenerationProvider {
  const providerId = context.settings.id;
  return {
    id: providerId,
    label: context.settings.id,
    generate: async (request, generationContext) => {
      const apiKey = await generationContext.auth.getApiKey(providerId);
      if (!apiKey) {
        throw new Error("Missing OpenAI apiKey in auth store");
      }
      const imageConfig = context.settings.image ?? {};
      const payload: Record<string, unknown> = {
        prompt: request.prompt,
        model: imageConfig.model ?? request.model ?? "gpt-image-1",
        size: request.size ?? imageConfig.size ?? "1024x1024",
        n: request.count ?? 1,
        response_format: "b64_json"
      };
      if (imageConfig.quality) {
        payload.quality = imageConfig.quality;
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
          name: `openai-image-${Date.now()}-${index + 1}.png`,
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
  };
}
