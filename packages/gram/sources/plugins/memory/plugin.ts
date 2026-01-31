import path from "node:path";

import { z } from "zod";

import { definePlugin } from "../../engine/plugins/types.js";
import { resolveWorkspaceDir, resolveWorkspacePath } from "../../engine/permissions.js";
import { MemoryStore } from "./store.js";
import {
  buildMemoryCreateEntityTool,
  buildMemoryListEntitiesTool,
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
    const configDir = path.resolve(api.engineSettings.engine?.dataDir ?? ".scout");
    const workspaceDir = resolveWorkspaceDir(configDir, api.engineSettings.assistant ?? null);
    const basePath = settings.basePath
      ? resolveWorkspacePath(workspaceDir, settings.basePath)
      : path.join(workspaceDir, "memory");
    const store = new MemoryStore(basePath);

    return {
      load: async () => {
        await store.ensure();
        api.registrar.registerTool(buildMemoryCreateEntityTool(store));
        api.registrar.registerTool(buildMemoryUpsertRecordTool(store));
        api.registrar.registerTool(buildMemoryListEntitiesTool(store));
      },
      unload: async () => {
        api.registrar.unregisterTool("memory_create_entity");
        api.registrar.unregisterTool("memory_upsert_record");
        api.registrar.unregisterTool("memory_list_entities");
      }
    };
  }
});
