import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ModuleRegistry } from "../modules/moduleRegistry.js";
import { InferenceRouter } from "../modules/inference/router.js";
import { FileStore } from "../../files/store.js";
import { PluginEventQueue } from "./events.js";
import { PluginManager } from "./manager.js";
import { PluginRegistry } from "./registry.js";
import { AuthStore } from "../../auth/store.js";
import type { PluginInstanceSettings } from "../../settings.js";
import { configResolve } from "../../config/configResolve.js";

const tempRoots: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claybot-plugin-test-"));
  tempRoots.push(dir);
  return dir;
}

async function writePluginFile(dir: string, source: string): Promise<string> {
  const pluginPath = path.join(dir, "plugin.js");
  await fs.writeFile(pluginPath, source, "utf8");
  return pluginPath;
}

function createManager(
  entryPath: string,
  pluginId: string,
  rootDir: string,
  queue: PluginEventQueue
): PluginManager {
  const modules = new ModuleRegistry({ onMessage: () => {} });
  const pluginRegistry = new PluginRegistry(modules);
  const config = configResolve({ engine: { dataDir: rootDir } }, path.join(rootDir, "settings.json"));
  const auth = new AuthStore(config);
  const fileStore = new FileStore(config);
  const inferenceRouter = new InferenceRouter({
    providers: [],
    registry: modules.inference,
    auth
  });
  const catalog = new Map([
    [
      pluginId,
      {
        descriptor: {
          id: pluginId,
          name: "Test Plugin",
          description: "Test plugin",
          entry: entryPath
        },
        entryPath,
        descriptorPath: path.join(rootDir, "plugin.json"),
        pluginDir: path.dirname(entryPath)
      }
    ]
  ]);
  return new PluginManager({
    config,
    registry: pluginRegistry,
    auth,
    fileStore,
    pluginCatalog: catalog,
    eventQueue: queue,
    inferenceRouter
  });
}

describe("PluginManager", () => {
  afterEach(async () => {
    const pending = tempRoots.splice(0, tempRoots.length);
    await Promise.all(
      pending.map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      })
    );
  });

  it("runs plugin instances without isolation across loads", async () => {
    const dir = await createTempDir();
    const pluginSource = `import { z } from "zod";

export const plugin = {
  settingsSchema: z.object({}).passthrough(),
  create: (api) => ({
    load: async () => {
      const globalRef = globalThis;
      globalRef.__counter = (globalRef.__counter ?? 0) + 1;
      api.events.emit({
        type: "test",
        payload: {
          count: globalRef.__counter,
          instance: api.instance.instanceId
        }
      });
    }
  })
};
`;
    const entryPath = await writePluginFile(dir, pluginSource);
    const queue = new PluginEventQueue();
    const manager = createManager(entryPath, "isolated", dir, queue);

    const alpha: PluginInstanceSettings = {
      instanceId: "alpha",
      pluginId: "isolated",
      enabled: true,
      settings: {}
    };
    const beta: PluginInstanceSettings = {
      instanceId: "beta",
      pluginId: "isolated",
      enabled: true,
      settings: {}
    };

    await manager.load(alpha);
    await manager.load(beta);

    const events = queue.drain();
    expect(events).toHaveLength(2);
    const counts = events.map((event) => (event.payload as { count: number }).count);
    expect(counts).toEqual([1, 2]);
  });

  it("syncs load/unload from settings changes", async () => {
    const dir = await createTempDir();
    const pluginSource = `import { z } from "zod";

export const plugin = {
  settingsSchema: z.object({}).passthrough(),
  create: () => ({
    load: async () => {},
    unload: async () => {}
  })
};
`;
    const entryPath = await writePluginFile(dir, pluginSource);
    const queue = new PluginEventQueue();
    const manager = createManager(entryPath, "sync", dir, queue);

    await manager.syncWithConfig(
      configResolve(
        {
          engine: { dataDir: dir },
          plugins: [
            {
              instanceId: "sync-one",
              pluginId: "sync",
              enabled: true,
              settings: {}
            }
          ]
        },
        path.join(dir, "settings.json")
      )
    );
    expect(manager.listLoaded()).toEqual(["sync-one"]);

    await manager.syncWithConfig(
      configResolve(
        {
          engine: { dataDir: dir },
          plugins: [
            {
              instanceId: "sync-one",
              pluginId: "sync",
              enabled: false
            }
          ]
        },
        path.join(dir, "settings.json")
      )
    );
    expect(manager.listLoaded()).toEqual([]);
  });
});
