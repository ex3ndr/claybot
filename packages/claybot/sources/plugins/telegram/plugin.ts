import path from "node:path";

import { z } from "zod";

import { TelegramConnector, type TelegramConnectorOptions } from "./connector.js";
import { definePlugin } from "../../engine/plugins/types.js";
import type { PluginOnboardingApi } from "@/types";

const allowedUidSchema = z.union([z.string().trim().min(1), z.number().int()]);

const settingsSchema = z
  .object({
    allowedUids: z
      .array(allowedUidSchema)
      .min(1)
      .transform((values) => Array.from(new Set(values.map((value) => String(value))))),
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
    const allowedUids = await promptAllowedUids(api);
    if (!allowedUids) {
      return null;
    }
    await api.auth.setToken(api.instanceId, token);
    return { settings: { allowedUids } };
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
            : config.statePath === null
              ? null
              : resolvePluginPath(api.dataDir, config.statePath);
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

function resolvePluginPath(baseDir: string, target: string): string {
  return path.isAbsolute(target) ? target : path.join(baseDir, target);
}

async function promptAllowedUids(
  api: PluginOnboardingApi
): Promise<string[] | null> {
  for (;;) {
    const input = await api.prompt.input({
      message: "Allowed Telegram user IDs (comma or space separated)"
    });
    if (input === null) {
      return null;
    }
    const parsed = parseAllowedUids(input);
    if (parsed.length > 0) {
      return parsed;
    }
    api.note("Please enter at least one UID.", "Telegram");
  }
}

function parseAllowedUids(input: string): string[] {
  const entries = input
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return Array.from(new Set(entries));
}
