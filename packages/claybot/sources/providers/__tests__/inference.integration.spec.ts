import { describe, it, expect } from "vitest";
import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AssistantMessage, Context } from "@mariozechner/pi-ai";

import { AuthStore } from "../../auth/store.js";
import { FileStore } from "../../files/store.js";
import { InferenceRouter } from "../../engine/modules/inference/router.js";
import { ImageGenerationRegistry } from "../../engine/modules/imageGenerationRegistry.js";
import { InferenceRegistry } from "../../engine/modules/inferenceRegistry.js";
import { ProviderManager } from "../manager.js";
import { listActiveInferenceProviders } from "../catalog.js";
import { configResolve } from "../../config/configResolve.js";
import { ConfigModule } from "../../engine/config/configModule.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..", "..");
loadEnv({ path: path.join(repoRoot, ".env") });
loadEnv({ path: path.join(process.cwd(), ".env") });

const RUN_INTEGRATION =
  process.env.RUN_INTEGRATION === "1" || process.env.RUN_INTEGRATION === "true";
const describeIf = RUN_INTEGRATION ? describe : describe.skip;

const providers = [
  { id: "openai", apiKeyEnv: ["OPENAI_API_TOKEN", "OPENAI_API_KEY"], modelEnv: ["OPENAI_MODEL"] },
  { id: "anthropic", apiKeyEnv: ["ANTHROPIC_API_KEY"], modelEnv: ["ANTHROPIC_MODEL"] },
  { id: "google", apiKeyEnv: ["GEMINI_API_TOKEN", "GEMINI_API_KEY"], modelEnv: ["GEMINI_MODEL"] },
  { id: "openrouter", apiKeyEnv: ["OPENROUTER_API_KEY"], modelEnv: ["OPENROUTER_MODEL"] },
  { id: "mistral", apiKeyEnv: ["MISTRAL_API_KEY"], modelEnv: ["MISTRAL_MODEL"] },
  { id: "groq", apiKeyEnv: ["GROQ_API_KEY"], modelEnv: ["GROQ_MODEL"] },
  { id: "xai", apiKeyEnv: ["XAI_API_KEY"], modelEnv: ["XAI_MODEL"] },
  { id: "cerebras", apiKeyEnv: ["CEREBRAS_API_KEY"], modelEnv: ["CEREBRAS_MODEL"] },
  { id: "minimax", apiKeyEnv: ["MINIMAX_API_KEY"], modelEnv: ["MINIMAX_MODEL"] },
  { id: "kimi-coding", apiKeyEnv: ["KIMI_API_KEY"], modelEnv: ["KIMI_MODEL"] }
];

const fallbackModels: Record<string, string[]> = {
  anthropic: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-20241022"],
  xai: ["grok-2-latest", "grok-beta"]
};

const openAiCompatible = {
  id: "openai-compatible",
  apiKeyEnv: ["OPENAI_COMPATIBLE_API_KEY"],
  baseUrlEnv: ["OPENAI_COMPATIBLE_BASE_URL"],
  modelEnv: ["OPENAI_COMPATIBLE_MODEL"],
  apiEnv: ["OPENAI_COMPATIBLE_API"]
};

describeIf("inference providers", () => {
  for (const provider of providers) {
    const apiKey = resolveEnv(provider.apiKeyEnv);
    const explicitModel = resolveEnv(provider.modelEnv);
    const fallback = fallbackModels[provider.id];
    const candidates = explicitModel ? [explicitModel] : fallback ?? [""];
    const itIf = apiKey ? it : it.skip;

    itIf(`${provider.id} completes a prompt`, async () => {
      let passed = false;
      let lastResult: { model?: string; message: AssistantMessage } | null = null;

      for (const candidate of candidates) {
        const { router, cleanup } = await setupProvider(provider.id, {
          apiKey,
          model: candidate || undefined
        });
        const result = await router.complete(buildContext(), "integration");
        const hasOutput = hasAssistantOutput(result.message);
        await cleanup();

        if (hasOutput) {
          passed = true;
          break;
        }

        lastResult = { model: candidate || undefined, message: result.message };
      }

      if (!passed && lastResult) {
        const text = extractAssistantText(lastResult.message);
        console.error(
          `[${provider.id}] no output for model ${lastResult.model ?? "(default)"}:`,
          {
            stopReason: lastResult.message.stopReason,
            errorMessage: lastResult.message.errorMessage,
            model: (lastResult.message as { model?: string }).model,
            text: text?.slice(0, 500) ?? "",
            content: lastResult.message.content
          }
        );
      }

      expect(passed).toBe(true);
    });
  }

  const compatKey = resolveEnv(openAiCompatible.apiKeyEnv);
  const compatBaseUrl = resolveEnv(openAiCompatible.baseUrlEnv);
  const compatModel = resolveEnv(openAiCompatible.modelEnv);
  const compatApi = resolveEnv(openAiCompatible.apiEnv) ?? undefined;

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
    const hasOutput = hasAssistantOutput(result.message);
    expect(hasOutput).toBe(true);
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

function hasAssistantOutput(message: Context["messages"][number]): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    return false;
  }
  if (message.content.length === 0) {
    return true;
  }
  const text = extractAssistantText(message);
  if (text && text.trim()) {
    return true;
  }
  if ((message.usage?.totalTokens ?? 0) > 0) {
    return true;
  }
  return message.content.some((part) => {
    if (part.type === "thinking") {
      return Boolean(part.thinking && part.thinking.trim());
    }
    if (part.type === "toolCall") {
      return true;
    }
    return false;
  });
}

function resolveEnv(keys: string | string[]): string {
  const candidates = Array.isArray(keys) ? keys : [keys];
  for (const key of candidates) {
    const value = process.env[key];
    if (value) {
      return value;
    }
  }
  return "";
}

type ProviderConfig = {
  apiKey: string;
  model?: string;
  options?: Record<string, unknown>;
};

async function setupProvider(providerId: string, config: ProviderConfig) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `claybot-${providerId}-`));
  const settings = {
    engine: { dataDir: dir },
    providers: [
      {
        id: providerId,
        enabled: true,
        model: config.model,
        options: config.options
      }
    ]
  };
  const resolvedConfig = configResolve(settings, path.join(dir, "settings.json"));
  const auth = new AuthStore(resolvedConfig);
  if (config.apiKey) {
    await auth.setApiKey(providerId, config.apiKey);
  }

  const inferenceRegistry = new InferenceRegistry();
  const imageRegistry = new ImageGenerationRegistry();

  const providerManager = new ProviderManager({
    config: new ConfigModule(resolvedConfig),
    auth,
    fileStore: new FileStore(resolvedConfig),
    inferenceRegistry,
    imageRegistry
  });

  await providerManager.reload();

  const router = new InferenceRouter({
    providers: listActiveInferenceProviders(resolvedConfig.settings),
    registry: inferenceRegistry,
    auth
  });

  return {
    router,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
}
