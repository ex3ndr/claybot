import path from "node:path";

import type { Context, AssistantMessage } from "@mariozechner/pi-ai";

import { AuthStore } from "../auth/store.js";
import { FileStore } from "../files/store.js";
import { ImageGenerationRegistry, InferenceRegistry } from "../engine/modules/_registry.js";
import { InferenceRouter } from "../engine/inference/router.js";
import {
  DEFAULT_SETTINGS_PATH,
  listProviders,
  readSettingsFile,
  type ProviderSettings
} from "../settings.js";
import { DEFAULT_CLAYBOT_DIR } from "../paths.js";
import { getProviderDefinition } from "../providers/catalog.js";
import { getLogger } from "../log.js";

export type DoctorOptions = {
  settings?: string;
};

export async function doctorCommand(options: DoctorOptions): Promise<void> {
  intro("claybot doctor");

  const settingsPath = path.resolve(options.settings ?? DEFAULT_SETTINGS_PATH);
  const settings = await readSettingsFile(settingsPath);
  const configuredProviders = listProviders(settings).filter(
    (provider) => provider.enabled !== false
  );

  if (configuredProviders.length === 0) {
    outro("No configured providers.");
    return;
  }

  const dataDir = path.resolve(settings.engine?.dataDir ?? DEFAULT_CLAYBOT_DIR);
  const auth = new AuthStore(path.join(dataDir, "auth.json"));
  const fileStore = new FileStore({ basePath: path.join(dataDir, "files") });

  let failed = 0;
  let skipped = 0;

  for (const providerSettings of configuredProviders) {
    const definition = getProviderDefinition(providerSettings.id);
    const providerLabel = definition?.name ?? providerSettings.id;
    console.log(`Checking ${providerLabel} (${providerSettings.id})...`);

    if (!definition) {
      failed += 1;
      console.log("  FAIL: Unknown provider definition.");
      continue;
    }

    if (!definition.capabilities.inference) {
      skipped += 1;
      console.log("  SKIP: No inference capability.");
      continue;
    }

    const result = await checkProvider(definition, providerSettings, auth, fileStore);
    if (!result.ok) {
      failed += 1;
      console.log(`  FAIL: ${result.message}`);
      continue;
    }

    console.log(`  OK: ${result.modelId}`);
  }

  if (failed > 0) {
    outro(`Doctor finished with issues. failed=${failed} skipped=${skipped}`);
    return;
  }

  outro(skipped > 0 ? `Doctor finished. skipped=${skipped}` : "Doctor finished OK.");
}

async function checkProvider(
  definition: NonNullable<ReturnType<typeof getProviderDefinition>>,
  providerSettings: ProviderSettings,
  auth: AuthStore,
  fileStore: FileStore
): Promise<{ ok: true; modelId: string } | { ok: false; message: string }> {
  const inferenceRegistry = new InferenceRegistry();
  const imageRegistry = new ImageGenerationRegistry();
  const logger = getLogger(`doctor.${providerSettings.id}`);

  const instance = await Promise.resolve(
    definition.create({
      settings: providerSettings,
      auth,
      fileStore,
      inferenceRegistry,
      imageRegistry,
      logger
    })
  );

  await instance.load?.();
  try {
    const registered = inferenceRegistry.get(providerSettings.id);
    if (!registered) {
      return { ok: false, message: "Provider did not register inference." };
    }

    const router = new InferenceRouter({
      providers: [providerSettings],
      registry: inferenceRegistry,
      auth
    });

    const result = await router.complete(buildContext(), "doctor");
    const ok = hasAssistantOutput(result.message);
    if (!ok) {
      return { ok: false, message: "No assistant output returned." };
    }
    return { ok: true, modelId: result.modelId };
  } catch (error) {
    return { ok: false, message: formatError(error) };
  } finally {
    try {
      await instance.unload?.();
    } catch (error) {
      console.log(`  WARN: unload failed: ${formatError(error)}`);
    }
  }
}

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

function hasAssistantOutput(message: AssistantMessage): boolean {
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    return false;
  }
  if (message.content.length === 0) {
    return true;
  }
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .filter((text): text is string => typeof text === "string" && text.length > 0)
    .join("\n");
  if (text.trim().length > 0) {
    return true;
  }
  if ((message.usage?.totalTokens ?? 0) > 0) {
    return true;
  }
  return message.content.some((part) => part.type === "toolCall" || part.type === "thinking");
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function intro(message: string): void {
  console.log(message);
}

function outro(message: string): void {
  console.log(message);
}
