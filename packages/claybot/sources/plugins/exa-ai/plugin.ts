import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { z } from "zod";

import { definePlugin } from "../../engine/plugins/types.js";

const settingsSchema = z
  .object({
    toolName: z.string().min(1).optional()
  })
  .passthrough();

const searchSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, description: "The search query" }),
    numResults: Type.Optional(
      Type.Number({ minimum: 1, maximum: 10, description: "Number of results to return" })
    ),
    type: Type.Optional(
      Type.Union(
        [
          Type.Literal("auto"),
          Type.Literal("fast"),
          Type.Literal("deep"),
          Type.Literal("neural")
        ],
        { description: "Search type: auto, fast, deep, or neural" }
      )
    ),
    useAutoprompt: Type.Optional(
      Type.Boolean({ description: "Whether to use Exa autoprompt to improve the query" })
    )
  },
  { additionalProperties: false }
);

type SearchArgs = Static<typeof searchSchema>;

type ExaSearchResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    publishedDate?: string;
    author?: string;
    score?: number;
    text?: string;
    highlights?: string[];
  }>;
  autopromptString?: string;
};

async function validateApiKey(apiKey: string): Promise<void> {
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey
    },
    body: JSON.stringify({
      query: "example",
      numResults: 1,
      type: "auto"
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Exa validation failed: ${response.status} - ${errorText}`);
  }
}

export const plugin = definePlugin({
  settingsSchema,
  onboarding: async (api) => {
    const apiKey = await api.prompt.input({
      message: "Exa AI API key"
    });
    if (!apiKey) {
      return null;
    }
    await validateApiKey(apiKey);
    await api.auth.setApiKey(api.instanceId, apiKey);
    return { settings: {} };
  },
  create: (api) => {
    const toolName = api.settings.toolName ?? "exa_search";
    const instanceId = api.instance.instanceId;

    return {
      load: async () => {
        api.registrar.registerTool({
          tool: {
            name: toolName,
            description:
              "Search the web using Exa AI. Supports auto, fast, deep, and neural search types.",
            parameters: searchSchema
          },
          execute: async (args, toolContext, toolCall) => {
            if (!toolContext.permissions.web) {
              throw new Error("Web access not granted. Request web access permission.");
            }
            const payload = args as SearchArgs;
            const apiKey = await api.auth.getApiKey(instanceId);
            if (!apiKey) {
              throw new Error("Missing exa-ai apiKey in auth store");
            }

            const requestBody: Record<string, unknown> = {
              query: payload.query,
              numResults: payload.numResults ?? 5,
              type: payload.type ?? "auto",
              useAutoprompt: payload.useAutoprompt ?? true,
              contents: {
                text: true,
                highlights: true
              }
            };

            const response = await fetch("https://api.exa.ai/search", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey
              },
              body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Exa search failed: ${response.status} - ${errorText}`);
            }

            const data = (await response.json()) as ExaSearchResponse;
            const results = data.results ?? [];

            let text: string;
            if (results.length === 0) {
              text = "No results found.";
            } else {
              const formatted = results.map((item, index) => {
                const title = item.title ?? "Untitled";
                const url = item.url ?? "";
                const snippet =
                  item.highlights?.[0] ?? item.text?.slice(0, 200) ?? "No description available.";
                const date = item.publishedDate ? ` (${item.publishedDate})` : "";
                return `${index + 1}. ${title}${date}\n${url}\n${snippet}`;
              });
              text = formatted.join("\n\n");

              if (data.autopromptString) {
                text = `Autoprompt: "${data.autopromptString}"\n\n${text}`;
              }
            }

            const toolMessage: ToolResultMessage = {
              role: "toolResult",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              content: [{ type: "text", text }],
              details: { count: results.length },
              isError: false,
              timestamp: Date.now()
            };

            return { toolMessage, files: [] };
          }
        });
      },
      unload: async () => {
        api.registrar.unregisterTool(toolName);
      }
    };
  }
});
