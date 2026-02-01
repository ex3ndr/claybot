import { describe, it, expect } from "vitest";
import { config as loadEnv } from "dotenv";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AuthStore } from "../../../auth/store.js";
import { FileStore } from "../../../files/store.js";
import type { PluginApi } from "@/types";
import type { PluginRegistrar } from "../../../engine/plugins/registry.js";
import type { ImageGenerationProvider } from "@/types";
import { getLogger } from "../../../log.js";
import { plugin as nanoBananaPro } from "../plugin.js";
import { configResolve } from "../../../config/configResolve.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..", "..", "..");
loadEnv({ path: path.join(repoRoot, ".env") });
loadEnv({ path: path.join(process.cwd(), ".env") });

const RUN_INTEGRATION =
  process.env.RUN_INTEGRATION === "1" || process.env.RUN_INTEGRATION === "true";
const describeIf = RUN_INTEGRATION ? describe : describe.skip;

const API_KEY_ENV = [
  "NANO_BANANA_PRO_GEMINI_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_API_TOKEN"
];

function resolveEnv(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value) {
      return value;
    }
  }
  return "";
}

describeIf("nano-banana-pro image generation", () => {
  const apiKey = resolveEnv(API_KEY_ENV);
  const itIf = apiKey ? it : it.skip;

  itIf("generates an image and writes it to .context", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nano-banana-pro-"));
    const config = configResolve({ engine: { dataDir: dir } }, path.join(dir, "settings.json"));
    const auth = new AuthStore(config);
    await auth.setApiKey("nano-banana-pro", apiKey);

    const fileStore = new FileStore(config);
    let registeredProvider: ImageGenerationProvider | null = null;

    const registrar = {
      registerImageProvider: (provider: ImageGenerationProvider) => {
        registeredProvider = provider;
      },
      unregisterImageProvider: () => undefined,
      registerInferenceProvider: () => undefined,
      unregisterInferenceProvider: () => undefined,
      registerTool: () => undefined,
      unregisterTool: () => undefined,
      registerConnector: () => undefined,
      unregisterConnector: async () => undefined
    } as unknown as PluginRegistrar;

    const settings = nanoBananaPro.settingsSchema.parse({ api: "gemini" });
    const inference = {
      complete: async () => {
        throw new Error("Inference not available in tests");
      }
    };
    const api: PluginApi<typeof settings> = {
      instance: { instanceId: "nano-banana-pro", pluginId: "nano-banana-pro", enabled: true },
      settings,
      engineSettings: {},
      logger: getLogger("test.nano-banana-pro"),
      auth,
      dataDir: dir,
      registrar,
      fileStore,
      inference,
      mode: "runtime",
      events: { emit: () => undefined }
    };

    const instance = await nanoBananaPro.create(api);
    await instance.load?.();

    expect(registeredProvider).not.toBeNull();
    const provider = registeredProvider!;

    const result = await provider.generate(
      {
        prompt: "A photorealistic banana on a skateboard, studio lighting.",
        model: "gemini-3-pro-image-preview",
        size: "1K",
        count: 1
      },
      {
        fileStore,
        auth,
        logger: getLogger("test.nano-banana-pro.generate")
      }
    );

    expect(result.files.length).toBeGreaterThan(0);
    const image = result.files[0]!;
    const outputDir = path.join(repoRoot, ".context");
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "nano-banana-pro-test.png");
    await fs.copyFile(image.path, outputPath);

    await instance.unload?.();
  }, 120000);
});
