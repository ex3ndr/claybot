import { describe, it, expect, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { FileStore } from "../../files/store.js";
import { getLogger } from "../../log.js";
import { AuthStore } from "../../auth/store.js";
import type { PluginApi } from "./types.js";
import type { PluginRegistrar } from "./registry.js";

import { plugin as openaiCodex } from "../../plugins/openai-codex.js";
import { plugin as anthropic } from "../../plugins/anthropic.js";
import { plugin as braveSearch } from "../../plugins/brave-search.js";
import { plugin as gptImage } from "../../plugins/gpt-image.js";
import { plugin as nanobanana } from "../../plugins/nanobanana.js";
import { plugin as telegram } from "../../plugins/telegram.js";

const tempRoots: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gram-plugin-builtin-"));
  tempRoots.push(dir);
  return dir;
}

function createRegistrar() {
  return {
    registerInferenceProvider: vi.fn(),
    unregisterInferenceProvider: vi.fn(),
    registerTool: vi.fn(),
    unregisterTool: vi.fn(),
    registerImageProvider: vi.fn(),
    unregisterImageProvider: vi.fn(),
    registerConnector: vi.fn(),
    unregisterConnector: vi.fn()
  } as unknown as PluginRegistrar;
}

async function createApi<TSettings>(
  instanceId: string,
  pluginId: string,
  settings: TSettings,
  registrar: PluginRegistrar,
  dir: string
): Promise<PluginApi<TSettings>> {
  const authPath = path.join(dir, "auth.json");
  const auth = new AuthStore(authPath);
  const fileStore = new FileStore({ basePath: path.join(dir, "files") });
  return {
    instance: { instanceId, pluginId, enabled: true },
    settings,
    engineSettings: {},
    logger: getLogger(`test.${instanceId}`),
    auth,
    dataDir: dir,
    registrar,
    fileStore,
    mode: "runtime",
    events: { emit: vi.fn() }
  };
}

describe("built-in plugins", () => {
  afterEach(async () => {
    const pending = tempRoots.splice(0, tempRoots.length);
    await Promise.all(
      pending.map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      })
    );
  });

  it("registers inference providers", async () => {
    const dir = await createTempDir();
    const registrar = createRegistrar();

    const openaiSettings = openaiCodex.settingsSchema.parse({});
    const openaiApi = await createApi("openai-main", "openai-codex", openaiSettings, registrar, dir);
    const openaiInstance = await openaiCodex.create(openaiApi);
    await openaiInstance.load?.();

    const anthropicSettings = anthropic.settingsSchema.parse({});
    const anthropicApi = await createApi("anthropic-main", "anthropic", anthropicSettings, registrar, dir);
    const anthropicInstance = await anthropic.create(anthropicApi);
    await anthropicInstance.load?.();

    expect(registrar.registerInferenceProvider).toHaveBeenCalledTimes(2);
  });

  it("registers tools and image providers", async () => {
    const dir = await createTempDir();
    const registrar = createRegistrar();

    const braveSettings = braveSearch.settingsSchema.parse({ toolName: "search_v2" });
    const braveApi = await createApi("brave-main", "brave-search", braveSettings, registrar, dir);
    const braveInstance = await braveSearch.create(braveApi);
    await braveInstance.load?.();

    const gptSettings = gptImage.settingsSchema.parse({});
    const gptApi = await createApi("gpt-main", "gpt-image", gptSettings, registrar, dir);
    const gptInstance = await gptImage.create(gptApi);
    await gptInstance.load?.();

    const nanoSettings = nanobanana.settingsSchema.parse({ endpoint: "https://example.com" });
    const nanoApi = await createApi("nano-main", "nanobanana", nanoSettings, registrar, dir);
    const nanoInstance = await nanobanana.create(nanoApi);
    await nanoInstance.load?.();

    expect(registrar.registerTool).toHaveBeenCalledWith(expect.objectContaining({ tool: expect.objectContaining({ name: "search_v2" }) }));
    expect(registrar.registerImageProvider).toHaveBeenCalledTimes(2);
  });

  it("builds a telegram plugin instance without executing load", async () => {
    const dir = await createTempDir();
    const registrar = createRegistrar();
    const settings = telegram.settingsSchema.parse({ polling: false });
    const api = await createApi("telegram-main", "telegram", settings, registrar, dir);
    const instance = await telegram.create(api);

    expect(typeof instance.load).toBe("function");
    expect(typeof instance.unload).toBe("function");
  });
});
