import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { PluginModuleLoader } from "./loader.js";

const tempRoots: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gram-plugin-loader-"));
  tempRoots.push(dir);
  return dir;
}

async function writeFile(target: string, contents: string): Promise<void> {
  await fs.writeFile(target, contents, "utf8");
}

describe("PluginModuleLoader", () => {
  afterEach(async () => {
    const pending = tempRoots.splice(0, tempRoots.length);
    await Promise.all(
      pending.map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      })
    );
  });

  it("loads a plugin module with local dependencies", async () => {
    const dir = await createTempDir();
    const helperPath = path.join(dir, "helper.js");
    const pluginPath = path.join(dir, "plugin.js");

    await writeFile(
      helperPath,
      "export function label(value) { return `helper:${value}`; }\n"
    );
    await writeFile(
      pluginPath,
      `import { z } from "zod";
import { label } from "./helper.js";

export const plugin = {
  settingsSchema: z.object({ name: z.string() }),
  create: (api) => ({
    load: async () => {
      api.events.emit({ type: "loaded", payload: { label: label(api.settings.name) } });
    }
  })
};
`
    );

    const loader = new PluginModuleLoader("test-plugin");
    const { module } = await loader.load(pluginPath);
    const settings = module.settingsSchema.parse({ name: "demo" });
    const instance = await module.create({
      instance: { instanceId: "demo", pluginId: "demo" },
      settings,
      engineSettings: {},
      logger: console as never,
      auth: {} as never,
      dataDir: dir,
      registrar: {} as never,
      fileStore: {} as never,
      mode: "runtime",
      events: { emit: () => {} }
    });

    expect(instance).toBeTruthy();
    expect(typeof instance.load).toBe("function");
  });
});
