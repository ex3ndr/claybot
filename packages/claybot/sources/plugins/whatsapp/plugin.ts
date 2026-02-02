import { promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { WhatsAppConnector, type WhatsAppConnectorOptions } from "./connector.js";
import { authenticate } from "./authenticate.js";
import { definePlugin } from "../../engine/plugins/types.js";
import type { PluginOnboardingApi } from "@/types";

const phoneSchema = z.union([z.string().trim().min(1), z.number().int()]);

const settingsSchema = z
  .object({
    allowedPhones: z
      .array(phoneSchema)
      .min(1)
      .transform((values) =>
        Array.from(new Set(values.map((value) => String(value).replace(/\D/g, ""))))
      ),
    authDir: z.string().optional(),
    printQRInTerminal: z.boolean().optional()
  })
  .passthrough();

type WhatsAppPluginConfig = Omit<
  WhatsAppConnectorOptions,
  "fileStore" | "dataDir" | "authDir"
> & {
  authDir?: string;
};

export const plugin = definePlugin({
  settingsSchema,
  onboarding: async (api) => {
    const allowedPhones = await promptAllowedPhones(api);
    if (!allowedPhones) {
      return null;
    }

    // Create auth directory and run authentication
    const authDir = path.join(api.dataDir, "whatsapp-auth");
    await fs.mkdir(authDir, { recursive: true });

    api.note(
      "Scan the QR code below with WhatsApp on your phone.\nOpen WhatsApp > Settings > Linked Devices > Link a Device",
      "WhatsApp Authentication"
    );

    const result = await authenticate({
      authDir,
      timeoutMs: 120_000 // 2 minutes to scan
    });

    if (!result.success) {
      api.note(`Authentication failed: ${result.reason}`, "WhatsApp");
      return null;
    }

    api.note("WhatsApp linked successfully!", "WhatsApp");
    return { settings: { allowedPhones } };
  },
  create: (api) => {
    const connectorId = api.instance.instanceId;
    let connector: WhatsAppConnector | null = null;

    return {
      load: async () => {
        if (api.mode === "validate") {
          return;
        }

        const config = api.settings as WhatsAppPluginConfig;
        const authDir = config.authDir
          ? resolvePluginPath(api.dataDir, config.authDir)
          : path.join(api.dataDir, "whatsapp-auth");

        connector = new WhatsAppConnector({
          ...config,
          authDir,
          fileStore: api.fileStore,
          dataDir: api.dataDir,
          onQRCode: (qr) => {
            api.logger.info({ qr }, "WhatsApp QR code ready - scan with your phone");
          },
          onFatal: (reason, error) => {
            api.logger.warn({ reason, error }, "WhatsApp connector fatal");
          }
        });

        api.registrar.registerConnector(connectorId, connector);
      },
      unload: async () => {
        if (connector) {
          await connector.shutdown("unload");
        }
        await api.registrar.unregisterConnector(connectorId);
      }
    };
  }
});

function resolvePluginPath(baseDir: string, target: string): string {
  return path.isAbsolute(target) ? target : path.join(baseDir, target);
}

async function promptAllowedPhones(
  api: PluginOnboardingApi
): Promise<string[] | null> {
  for (;;) {
    const input = await api.prompt.input({
      message: "Allowed phone numbers (with country code, comma or space separated)"
    });
    if (input === null) {
      return null;
    }
    const parsed = parseAllowedPhones(input);
    if (parsed.length > 0) {
      return parsed;
    }
    api.note("Please enter at least one phone number.", "WhatsApp");
  }
}

function parseAllowedPhones(input: string): string[] {
  const entries = input
    .split(/[,\s]+/)
    .map((entry) => entry.trim().replace(/\D/g, ""))
    .filter((entry) => entry.length >= 10);
  return Array.from(new Set(entries));
}
