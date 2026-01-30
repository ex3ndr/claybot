import type { ProviderDefinition } from "./types.js";
import type { ProviderSettings } from "../settings.js";
import type { FileStore } from "../files/store.js";

type NanobananaResponse = {
  data?: Array<{
    b64_json?: string;
    base64?: string;
    url?: string;
    image?: string;
  }>;
  image?: string;
  image_base64?: string;
  output?: string;
};

export const nanobananaProvider: ProviderDefinition = {
  id: "nanobanana",
  name: "Nanobanana",
  description: "Custom image generation endpoint.",
  auth: "apiKey",
  capabilities: {
    image: true
  },
  onboarding: async (api) => {
    const endpoint = await api.prompt.input({
      message: "Nanobanana endpoint URL"
    });
    if (!endpoint) {
      return null;
    }

    const apiKey = await api.prompt.input({
      message: "Nanobanana API key"
    });
    if (!apiKey) {
      return null;
    }
    await api.auth.setApiKey(api.id, apiKey);

    return {
      settings: {
        image: {
          endpoint
        }
      } satisfies Partial<ProviderSettings>
    };
  },
  create: (context) => ({
    load: async () => {
      const providerId = context.settings.id;
      const config = context.settings.image ?? {};
      context.imageRegistry.register(providerId, {
        id: providerId,
        label: providerId,
        generate: async (request, generationContext) => {
          const apiKey = await generationContext.auth.getApiKey(providerId);
          if (!apiKey) {
            throw new Error("Missing nanobanana apiKey in auth store");
          }
          if (!config.endpoint) {
            throw new Error("Missing nanobanana endpoint");
          }
          const headers: Record<string, string> = {
            "Content-Type": "application/json"
          };
          const headerName = config.apiKeyHeader ?? "Authorization";
          const prefix = config.apiKeyPrefix ?? "Bearer ";
          headers[headerName] = `${prefix}${apiKey}`;

          const payload: Record<string, unknown> = {
            prompt: request.prompt,
            model: request.model ?? config.model,
            size: request.size ?? config.size,
            n: request.count ?? 1
          };

          const response = await fetch(config.endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
          });
          if (!response.ok) {
            throw new Error(`Nanobanana image generation failed: ${response.status}`);
          }
          const data = (await response.json()) as NanobananaResponse;
          const files = await extractImages(data, generationContext.fileStore, providerId);
          return { files };
        }
      });
    },
    unload: async () => {
      context.imageRegistry.unregister(context.settings.id);
    }
  })
};

async function extractImages(
  data: NanobananaResponse,
  fileStore: FileStore,
  source: string
) {
  const files = [];
  const entries = data.data ?? [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) {
      continue;
    }
    const base64 = entry.b64_json ?? entry.base64 ?? entry.image ?? null;
    if (base64) {
      const buffer = Buffer.from(base64, "base64");
      const stored = await fileStore.saveBuffer({
        name: `nanobanana-${Date.now()}-${index + 1}.png`,
        mimeType: "image/png",
        data: buffer,
        source
      });
      files.push({
        id: stored.id,
        name: stored.name,
        mimeType: stored.mimeType,
        size: stored.size,
        path: stored.path
      });
      continue;
    }
    if (entry.url) {
      const downloaded = await fetch(entry.url);
      if (!downloaded.ok) {
        continue;
      }
      const contentType = downloaded.headers.get("content-type") ?? "image/png";
      const buffer = Buffer.from(await downloaded.arrayBuffer());
      const stored = await fileStore.saveBuffer({
        name: `nanobanana-${Date.now()}-${index + 1}.png`,
        mimeType: contentType,
        data: buffer,
        source
      });
      files.push({
        id: stored.id,
        name: stored.name,
        mimeType: stored.mimeType,
        size: stored.size,
        path: stored.path
      });
    }
  }

  if (files.length === 0) {
    const single = data.image_base64 ?? data.image ?? data.output ?? null;
    if (single) {
      const buffer = Buffer.from(single, "base64");
      const stored = await fileStore.saveBuffer({
        name: `nanobanana-${Date.now()}-1.png`,
        mimeType: "image/png",
        data: buffer,
        source
      });
      files.push({
        id: stored.id,
        name: stored.name,
        mimeType: stored.mimeType,
        size: stored.size,
        path: stored.path
      });
    }
  }

  return files;
}
