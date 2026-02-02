import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { z } from "zod";

import { definePlugin } from "../../engine/plugins/types.js";

const settingsSchema = z
  .object({
    toolName: z.string().min(1).optional(),
    model: z.string().min(1).optional()
  })
  .passthrough();

const searchSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, description: "The search query" })
  },
  { additionalProperties: false }
);

type SearchArgs = Static<typeof searchSchema>;

type PerplexityResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  citations?: string[];
};

async function validateApiKey(apiKey: string): Promise<void> {
  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        {
          role: "user",
          content: "Test request."
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity validation failed: ${response.status} - ${errorText}`);
  }
}

export const plugin = definePlugin({
  settingsSchema,
  onboarding: async (api) => {
    const apiKey = await api.prompt.input({
      message: "Perplexity API key"
    });
    if (!apiKey) {
      return null;
    }
    await validateApiKey(apiKey);
    await api.auth.setApiKey(api.instanceId, apiKey);
    return { settings: {} };
  },
  create: (api) => {
    const toolName = api.settings.toolName ?? "perplexity_search";
    const model = api.settings.model ?? "sonar";
    const instanceId = api.instance.instanceId;

    return {
      load: async () => {
        api.registrar.registerTool({
          tool: {
            name: toolName,
            description:
              "Search the web using Perplexity AI. Returns an AI-generated answer with citations.",
            parameters: searchSchema
          },
          execute: async (args, toolContext, toolCall) => {
            if (!toolContext.permissions.web) {
              throw new Error("Web access not granted. Request web access permission.");
            }
            const payload = args as SearchArgs;
            const apiKey = await api.auth.getApiKey(instanceId);
            if (!apiKey) {
              throw new Error("Missing perplexity-search apiKey in auth store");
            }

            const response = await fetch("https://api.perplexity.ai/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`
              },
              body: JSON.stringify({
                model,
                messages: [
                  {
                    role: "user",
                    content: payload.query
                  }
                ]
              })
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Perplexity search failed: ${response.status} - ${errorText}`);
            }

            const data = (await response.json()) as PerplexityResponse;
            const content = data.choices?.[0]?.message?.content ?? "No results found.";
            const citations = data.citations ?? [];

            let text = content;
            if (citations.length > 0) {
              text += "\n\nSources:\n" + citations.map((url, i) => `${i + 1}. ${url}`).join("\n");
            }

            const toolMessage: ToolResultMessage = {
              role: "toolResult",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              content: [{ type: "text", text }],
              details: { citationsCount: citations.length },
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
