import path from "node:path";

import { z } from "zod";

import { TelegramConnector, type TelegramConnectorOptions } from "../engine/connectors/telegram.js";
import { definePlugin } from "../engine/plugins/types.js";

const settingsSchema = z
  .object({
    polling: z.boolean().optional(),
    clearWebhook: z.boolean().optional(),
    statePath: z.string().nullable().optional(),
    retry: z
      .object({
        minDelayMs: z.number().optional(),
        maxDelayMs: z.number().optional(),
        factor: z.number().optional(),
        jitter: z.number().optional()
      })
      .optional()
  })
  .passthrough();

type TelegramPluginConfig = Omit<TelegramConnectorOptions, "token" | "fileStore" | "dataDir">;

export const plugin = definePlugin({
  settingsSchema,
  onboarding: async (api) => {
    const token = await api.prompt.input({
      message: "Telegram bot token"
    });
    if (!token) {
      return null;
    }
    await api.auth.setToken(api.instanceId, token);
    return { settings: {} };
  },
  create: (api) => {
    const connectorId = api.instance.instanceId;
    return {
      load: async () => {
        const token = await api.auth.getToken(connectorId);
        if (!token) {
          throw new Error("Missing telegram token in auth store");
        }
        if (api.mode === "validate") {
          return;
        }
        const config = api.settings as TelegramPluginConfig;
        const statePath =
          config.statePath === undefined
            ? path.join(api.dataDir, "telegram-offset.json")
            : config.statePath;
        const connector = new TelegramConnector({
          ...config,
          statePath,
          token,
          fileStore: api.fileStore,
          dataDir: api.dataDir,
          enableGracefulShutdown: false,
          onFatal: (reason, error) => {
            api.logger.warn({ reason, error }, "Telegram connector fatal");
          }
        });
        api.registrar.registerConnector(connectorId, connector);
      },
      unload: async () => {
        await api.registrar.unregisterConnector(connectorId);
      }
    };
  }
});
