import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { z } from "zod";

import { definePlugin } from "../engine/plugins/types.js";

const settingsSchema = z
  .object({
    toolName: z.string().min(1).optional()
  })
  .passthrough();

const searchSchema = Type.Object(
  {
    query: Type.String({ minLength: 1 }),
    count: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
    country: Type.Optional(Type.String({ minLength: 2 })),
    language: Type.Optional(Type.String({ minLength: 2 })),
    safeSearch: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);

type SearchArgs = Static<typeof searchSchema>;

type BraveSearchResponse = {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      language?: string;
      published?: string;
    }>;
  };
};

export const plugin = definePlugin({
  settingsSchema,
  onboarding: async (api) => {
    const apiKey = await api.prompt.input({
      message: "Brave Search API key"
    });
    if (!apiKey) {
      return null;
    }
    await api.auth.setApiKey(api.instanceId, apiKey);
    return { settings: {} };
  },
  create: (api) => {
    const toolName = api.settings.toolName ?? "web_search";
    const instanceId = api.instance.instanceId;

    return {
      load: async () => {
        api.registrar.registerTool({
          tool: {
            name: toolName,
            description: "Search the web using Brave Search and return concise results.",
            parameters: searchSchema
          },
          execute: async (args, _toolContext, toolCall) => {
            const payload = args as SearchArgs;
            const apiKey = await api.auth.getApiKey(instanceId);
            if (!apiKey) {
              throw new Error("Missing brave-search apiKey in auth store");
            }

            const url = new URL("https://api.search.brave.com/res/v1/web/search");
            url.searchParams.set("q", payload.query);
            if (payload.count) {
              url.searchParams.set("count", String(payload.count));
            }
            if (payload.country) {
              url.searchParams.set("country", payload.country);
            }
            if (payload.language) {
              url.searchParams.set("language", payload.language);
            }
            if (payload.safeSearch !== undefined) {
              url.searchParams.set("safesearch", payload.safeSearch ? "moderate" : "off");
            }

            const response = await fetch(url.toString(), {
              headers: {
                Accept: "application/json",
                "X-Subscription-Token": apiKey
              }
            });
            if (!response.ok) {
              throw new Error(`Brave search failed: ${response.status}`);
            }
            const data = (await response.json()) as BraveSearchResponse;
            const results = data.web?.results ?? [];
            const limited = results.slice(0, payload.count ?? 5);
            const text =
              limited.length === 0
                ? "No results found."
                : limited
                    .map((item, index) => {
                      const title = item.title ?? "Untitled";
                      const urlItem = item.url ?? "";
                      const description = item.description ?? "";
                      return `${index + 1}. ${title}\n${urlItem}\n${description}`.trim();
                    })
                    .join("\n\n");

            const toolMessage: ToolResultMessage = {
              role: "toolResult",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              content: [{ type: "text", text }],
              details: { count: limited.length },
              isError: false,
              timestamp: Date.now()
            };

            return { toolMessage };
          }
        });
      },
      unload: async () => {
        api.registrar.unregisterTool(toolName);
      }
    };
  }
});
