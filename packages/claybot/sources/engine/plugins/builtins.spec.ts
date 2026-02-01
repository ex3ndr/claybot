import { describe, it, expect, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { FileStore } from "../../files/store.js";
import { getLogger } from "../../log.js";
import { AuthStore } from "../../auth/store.js";
import type { PluginApi } from "@/types";
import type { PluginRegistrar } from "./registry.js";
import { configResolve } from "../../config/configResolve.js";

import { plugin as braveSearch } from "../../plugins/brave-search/plugin.js";
import { plugin as memory } from "../../plugins/memory/plugin.js";
import { plugin as telegram } from "../../plugins/telegram/plugin.js";

const tempRoots: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claybot-plugin-builtin-"));
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
  const config = configResolve({ engine: { dataDir: dir } }, path.join(dir, "settings.json"));
  const auth = new AuthStore(config);
  const fileStore = new FileStore(config);
  const inference = {
    complete: async () => {
      throw new Error("Inference not available in tests");
    }
  };
  return {
    instance: { instanceId, pluginId, enabled: true },
    settings,
    engineSettings: {},
    logger: getLogger(`test.${instanceId}`),
    auth,
    dataDir: dir,
    registrar,
    fileStore,
    inference,
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

  it("registers tools", async () => {
    const dir = await createTempDir();
    const registrar = createRegistrar();

    const braveSettings = braveSearch.settingsSchema.parse({ toolName: "search_v2" });
    const braveApi = await createApi("brave-main", "brave-search", braveSettings, registrar, dir);
    const braveInstance = await braveSearch.create(braveApi);
    await braveInstance.load?.();

    const memorySettings = memory.settingsSchema.parse({});
    const memoryApi = await createApi("memory-main", "memory", memorySettings, registrar, dir);
    const memoryInstance = await memory.create(memoryApi);
    await memoryInstance.load?.();

    expect(registrar.registerTool).toHaveBeenCalledWith(expect.objectContaining({ tool: expect.objectContaining({ name: "search_v2" }) }));
    expect(registrar.registerTool).toHaveBeenCalledWith(expect.objectContaining({ tool: expect.objectContaining({ name: "memory_create_entity" }) }));
    expect(registrar.registerTool).toHaveBeenCalledWith(expect.objectContaining({ tool: expect.objectContaining({ name: "memory_upsert_record" }) }));
    expect(registrar.registerTool).toHaveBeenCalledWith(expect.objectContaining({ tool: expect.objectContaining({ name: "memory_list_entities" }) }));
  });

  it("builds a telegram plugin instance without executing load", async () => {
    const dir = await createTempDir();
    const registrar = createRegistrar();
    const settings = telegram.settingsSchema.parse({
      polling: false,
      allowedUids: ["123456789"]
    });
    const api = await createApi("telegram-main", "telegram", settings, registrar, dir);
    const instance = await telegram.create(api);

    expect(typeof instance.load).toBe("function");
    expect(typeof instance.unload).toBe("function");
  });
});
