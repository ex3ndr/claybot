import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { AuthStore } from "../auth/store.js";
import { FileStore } from "../files/store.js";
import { configResolve } from "../config/configResolve.js";
import { ImageGenerationRegistry } from "../engine/modules/imageGenerationRegistry.js";
import { InferenceRegistry } from "../engine/modules/inferenceRegistry.js";
import { ProviderManager } from "./manager.js";
import type { ProviderDefinition } from "./types.js";
import { ConfigModule } from "../engine/config/configModule.js";

const tempRoots: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claybot-provider-manager-"));
  tempRoots.push(dir);
  return dir;
}

function configWithProvider(
  root: string,
  options: {
    enabled?: boolean;
    settings?: Record<string, unknown>;
  } = {}
) {
  return configResolve(
    {
      engine: { dataDir: root },
      providers: [
        {
          id: "fake-provider",
          enabled: options.enabled ?? true,
          options: options.settings
        }
      ]
    },
    path.join(root, "settings.json")
  );
}

describe("ProviderManager", () => {
  afterEach(async () => {
    const pending = tempRoots.splice(0, tempRoots.length);
    await Promise.all(
      pending.map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      })
    );
  });

  it("reloads only when provider settings change and always cleans registrations", async () => {
    const root = await createTempDir();
    const inferenceRegistry = new InferenceRegistry();
    const imageRegistry = new ImageGenerationRegistry();
    const baseConfig = configWithProvider(root, {
      settings: {
        alpha: 1,
        nested: { bravo: 2 }
      }
    });

    const definition: ProviderDefinition = {
      id: "fake-provider",
      name: "Fake Provider",
      description: "Test provider",
      auth: "none",
      capabilities: { inference: true },
      create: (context) => ({
        load: async () => {
          const key = String((context.settings.options as { alpha?: number })?.alpha ?? "none");
          context.inferenceRegistry.register(context.settings.id, {
            id: `fake-provider-${key}`,
            label: "fake",
            createClient: async () => ({
              modelId: "fake",
              complete: async () => ({}) as never,
              stream: () => ({}) as never
            })
          });
        }
      })
    };

    const manager = new ProviderManager({
      configModule: new ConfigModule(baseConfig),
      auth: new AuthStore(baseConfig),
      fileStore: new FileStore(baseConfig),
      inferenceRegistry,
      imageRegistry,
      providerDefinitionResolve: (id) => (id === "fake-provider" ? definition : null)
    });

    await manager.sync();
    expect(inferenceRegistry.list().map((item) => item.id)).toEqual(["fake-provider-1"]);
    expect(manager.listLoaded()).toEqual(["fake-provider"]);

    const equalByValueConfig = configWithProvider(root, {
      settings: {
        nested: { bravo: 2 },
        alpha: 1
      }
    });
    manager.reload(equalByValueConfig);
    await manager.sync();
    expect(inferenceRegistry.list().map((item) => item.id)).toEqual(["fake-provider-1"]);

    const changedConfig = configWithProvider(root, {
      settings: {
        alpha: 2,
        nested: { bravo: 2 }
      }
    });
    manager.reload(changedConfig);
    await manager.sync();
    expect(inferenceRegistry.list().map((item) => item.id)).toEqual(["fake-provider-2"]);

    const disabledConfig = configWithProvider(root, { enabled: false });
    manager.reload(disabledConfig);
    await manager.sync();
    expect(inferenceRegistry.list()).toEqual([]);
    expect(manager.listLoaded()).toEqual([]);
  });

  it("cleans partial registrations when provider load fails", async () => {
    const root = await createTempDir();
    const inferenceRegistry = new InferenceRegistry();
    const imageRegistry = new ImageGenerationRegistry();
    const config = configWithProvider(root);

    const definition: ProviderDefinition = {
      id: "fake-provider",
      name: "Fake Provider",
      description: "Test provider",
      auth: "none",
      capabilities: { inference: true, image: true },
      create: (context) => ({
        load: async () => {
          context.inferenceRegistry.register(context.settings.id, {
            id: "fake-provider-inference",
            label: "fake",
            createClient: async () => ({
              modelId: "fake",
              complete: async () => ({}) as never,
              stream: () => ({}) as never
            })
          });
          context.imageRegistry.register(context.settings.id, {
            id: "fake-provider-image",
            label: "fake",
            generate: async () => ({ files: [] })
          });
          throw new Error("Provider load failed");
        }
      })
    };

    const manager = new ProviderManager({
      configModule: new ConfigModule(config),
      auth: new AuthStore(config),
      fileStore: new FileStore(config),
      inferenceRegistry,
      imageRegistry,
      providerDefinitionResolve: (id) => (id === "fake-provider" ? definition : null)
    });

    await expect(manager.sync()).rejects.toThrow("Provider load failed");
    expect(manager.listLoaded()).toEqual([]);
    expect(inferenceRegistry.list()).toEqual([]);
    expect(imageRegistry.list()).toEqual([]);
  });
});
