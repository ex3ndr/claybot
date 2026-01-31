import path from "node:path";

import { z } from "zod";

import { definePlugin } from "../../engine/plugins/types.js";
import { MemoryStore } from "./store.js";
import {
  buildMemoryCreateEntityTool,
  buildMemoryUpsertRecordTool
} from "./tool.js";

const settingsSchema = z
  .object({
    basePath: z.string().optional()
  })
  .passthrough();

type MemorySettings = z.infer<typeof settingsSchema>;

export const plugin = definePlugin({
  settingsSchema,
  create: (api) => {
    const settings = api.settings as MemorySettings;
    const basePath =
      resolvePluginPath(api.dataDir, settings.basePath) ??
      path.join(api.dataDir, "memory");
    const store = new MemoryStore(basePath);

    return {
      load: async () => {
        await store.ensure();
        api.registrar.registerTool(buildMemoryCreateEntityTool(store));
        api.registrar.registerTool(buildMemoryUpsertRecordTool(store));
      },
      unload: async () => {
        api.registrar.unregisterTool("memory_create_entity");
        api.registrar.unregisterTool("memory_upsert_record");
      }
    };
  }
});

function resolvePluginPath(baseDir: string, target?: string): string | undefined {
  if (!target) {
    return undefined;
  }
  return path.isAbsolute(target) ? target : path.join(baseDir, target);
}
