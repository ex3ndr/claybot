import { describe, it, expect } from "vitest";
import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Context } from "@mariozechner/pi-ai";

import { AuthStore } from "../../../auth/store.js";
import { FileStore } from "../../../files/store.js";
import { buildPluginCatalog } from "../../../engine/plugins/catalog.js";
import { PluginEventQueue } from "../../../engine/plugins/events.js";
import { PluginManager } from "../../../engine/plugins/manager.js";
import { PluginRegistry } from "../../../engine/plugins/registry.js";
import { InferenceRouter } from "../../../engine/inference/router.js";
import {
  ConnectorRegistry,
  ImageGenerationRegistry,
  InferenceRegistry,
  ToolResolver
} from "../../../engine/modules.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..", "..", "..");
loadEnv({ path: path.join(repoRoot, ".env") });
loadEnv({ path: path.join(process.cwd(), ".env") });

const RUN_INTEGRATION =
  process.env.RUN_INTEGRATION === "1" || process.env.RUN_INTEGRATION === "true";
const describeIf = RUN_INTEGRATION ? describe : describe.skip;

const providers = [
  { id: "openai", apiKeyEnv: "OPENAI_API_KEY", modelEnv: "OPENAI_MODEL" },
  { id: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY", modelEnv: "ANTHROPIC_MODEL" },
  { id: "openrouter", apiKeyEnv: "OPENROUTER_API_KEY", modelEnv: "OPENROUTER_MODEL" },
  { id: "mistral", apiKeyEnv: "MISTRAL_API_KEY", modelEnv: "MISTRAL_MODEL" },
  { id: "groq", apiKeyEnv: "GROQ_API_KEY", modelEnv: "GROQ_MODEL" },
  { id: "xai", apiKeyEnv: "XAI_API_KEY", modelEnv: "XAI_MODEL" },
  { id: "cerebras", apiKeyEnv: "CEREBRAS_API_KEY", modelEnv: "CEREBRAS_MODEL" },
  { id: "minimax", apiKeyEnv: "MINIMAX_API_KEY", modelEnv: "MINIMAX_MODEL" },
  { id: "kimi-coding", apiKeyEnv: "KIMI_API_KEY", modelEnv: "KIMI_MODEL" }
];

const openAiCompatible = {
  id: "openai-compatible",
  apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
  baseUrlEnv: "OPENAI_COMPATIBLE_BASE_URL",
  modelEnv: "OPENAI_COMPATIBLE_MODEL",
  apiEnv: "OPENAI_COMPATIBLE_API"
};

describeIf("inference provider plugins", () => {
  for (const provider of providers) {
    const apiKey = process.env[provider.apiKeyEnv] ?? "";
    const model = process.env[provider.modelEnv] ?? undefined;
    const itIf = apiKey ? it : it.skip;

    itIf(`${provider.id} completes a prompt`, async () => {
      const { router, cleanup } = await setupProvider(provider.id, {
        apiKey,
        model
      });
      const result = await router.complete(buildContext(), "integration");
      const text = extractAssistantText(result.message);
      expect(text).toBeTruthy();
      await cleanup();
    });
  }

  const compatKey = process.env[openAiCompatible.apiKeyEnv] ?? "";
  const compatBaseUrl = process.env[openAiCompatible.baseUrlEnv] ?? "";
  const compatModel = process.env[openAiCompatible.modelEnv] ?? "";
  const compatApi = process.env[openAiCompatible.apiEnv] ?? undefined;

  const compatReady = compatBaseUrl && compatModel;
  const compatIt = compatReady ? it : it.skip;

  compatIt("openai-compatible completes a prompt", async () => {
    const { router, cleanup } = await setupProvider("openai-compatible", {
      apiKey: compatKey,
      model: compatModel,
      options: {
        baseUrl: compatBaseUrl,
        modelId: compatModel,
        api: compatApi
      }
    });
    const result = await router.complete(buildContext(), "integration");
    const text = extractAssistantText(result.message);
    expect(text).toBeTruthy();
    await cleanup();
  });
});

function buildContext(): Context {
  return {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Say OK." }],
        timestamp: Date.now()
      }
    ],
    tools: []
  };
}

function extractAssistantText(message: Context["messages"][number]): string | null {
  if (message.role !== "assistant") {
    return null;
  }
  const parts = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .filter((text): text is string => typeof text === "string" && text.length > 0);
  return parts.join("\n");
}

type ProviderConfig = {
  apiKey: string;
  model?: string;
  options?: Record<string, unknown>;
};

async function setupProvider(providerId: string, config: ProviderConfig) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `gram-${providerId}-`));
  const auth = new AuthStore(path.join(dir, "auth.json"));
  if (config.apiKey) {
    await auth.setApiKey(providerId, config.apiKey);
  }

  const connectorRegistry = new ConnectorRegistry({
    onMessage: () => {}
  });
  const inferenceRegistry = new InferenceRegistry();
  const imageRegistry = new ImageGenerationRegistry();
  const toolResolver = new ToolResolver();
  const registry = new PluginRegistry(
    connectorRegistry,
    inferenceRegistry,
    imageRegistry,
    toolResolver
  );

  const manager = new PluginManager({
    settings: {
      inference: {
        providers: [
          {
            id: providerId,
            model: config.model,
            options: config.options
          }
        ]
      }
    },
    registry,
    auth,
    fileStore: new FileStore({ basePath: path.join(dir, "files") }),
    pluginCatalog: buildPluginCatalog(),
    dataDir: dir,
    eventQueue: new PluginEventQueue()
  });

  await manager.load({
    instanceId: providerId,
    pluginId: providerId,
    enabled: true,
    settings: config.options ?? {}
  });

  const router = new InferenceRouter({
    providers: [
      {
        id: providerId,
        model: config.model,
        options: config.options
      }
    ],
    registry: inferenceRegistry,
    auth
  });

  return {
    router,
    cleanup: async () => {
      await manager.unloadAll();
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
}
