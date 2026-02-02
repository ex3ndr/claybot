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

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: {
          uri?: string;
          title?: string;
        };
      }>;
      webSearchQueries?: string[];
    };
  }>;
  error?: {
    message?: string;
  };
};

export const plugin = definePlugin({
  settingsSchema,
  onboarding: async (api) => {
    // Reuses existing Google provider credentials
    const existingKey = await api.auth.getApiKey("google");
    if (existingKey) {
      api.note("Using existing Google provider credentials.", "Setup");
      return { settings: {} };
    }
    // Fallback: prompt for API key if Google provider not configured
    const apiKey = await api.prompt.input({
      message: "Google AI API key (or configure 'google' provider first)"
    });
    if (!apiKey) {
      return null;
    }
    await api.auth.setApiKey(api.instanceId, apiKey);
    return { settings: {} };
  },
  create: (api) => {
    const toolName = api.settings.toolName ?? "gemini_search";
    const model = api.settings.model ?? "gemini-2.0-flash";
    const instanceId = api.instance.instanceId;

    return {
      load: async () => {
        api.registrar.registerTool({
          tool: {
            name: toolName,
            description:
              "Search the web using Google Gemini with Search Grounding. Returns AI-generated answer with source citations.",
            parameters: searchSchema
          },
          execute: async (args, toolContext, toolCall) => {
            if (!toolContext.permissions.web) {
              throw new Error("Web access not granted. Request web access permission.");
            }
            const payload = args as SearchArgs;

            // Try plugin-specific key first, fallback to Google provider key
            let apiKey = await api.auth.getApiKey(instanceId);
            if (!apiKey) {
              apiKey = await api.auth.getApiKey("google");
            }
            if (!apiKey) {
              throw new Error(
                "Missing API key. Configure 'google' provider or run plugin onboarding."
              );
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

            const response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
              },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [{ text: payload.query }]
                  }
                ],
                tools: [{ google_search: {} }]
              })
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Gemini search failed: ${response.status} - ${errorText}`);
            }

            const data = (await response.json()) as GeminiResponse;

            if (data.error) {
              throw new Error(`Gemini search failed: ${data.error.message}`);
            }

            const candidate = data.candidates?.[0];
            const content =
              candidate?.content?.parts?.map((p) => p.text).join("") ?? "No results found.";

            // Extract grounding sources
            const groundingChunks = candidate?.groundingMetadata?.groundingChunks ?? [];
            const sources = groundingChunks
              .filter((chunk) => chunk.web?.uri)
              .map((chunk, i) => `${i + 1}. ${chunk.web?.title ?? "Source"}: ${chunk.web?.uri}`)
              .join("\n");

            let text = content;
            if (sources) {
              text += "\n\nSources:\n" + sources;
            }

            const toolMessage: ToolResultMessage = {
              role: "toolResult",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              content: [{ type: "text", text }],
              details: { sourcesCount: groundingChunks.length },
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
