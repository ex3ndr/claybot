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

type OpenAIResponseOutput = {
  type: string;
  id?: string;
  status?: string;
  content?: Array<{
    type: string;
    text?: string;
    annotations?: Array<{
      type: string;
      url?: string;
      title?: string;
    }>;
  }>;
};

type OpenAIResponse = {
  output?: OpenAIResponseOutput[];
  error?: {
    message?: string;
  };
};

async function validateApiKey(apiKey: string): Promise<void> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search" }],
      input: "Test request."
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI validation failed: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as OpenAIResponse;
  if (data.error?.message) {
    throw new Error(`OpenAI validation failed: ${data.error.message}`);
  }
}

export const plugin = definePlugin({
  settingsSchema,
  onboarding: async (api) => {
    // Reuses existing OpenAI provider credentials
    const existingKey = await api.auth.getApiKey("openai");
    if (existingKey) {
      api.note("Using existing OpenAI provider credentials.", "Setup");
      return { settings: {} };
    }
    // Fallback: prompt for API key if OpenAI provider not configured
    const apiKey = await api.prompt.input({
      message: "OpenAI API key (or configure 'openai' provider first)"
    });
    if (!apiKey) {
      return null;
    }
    await validateApiKey(apiKey);
    await api.auth.setApiKey(api.instanceId, apiKey);
    return { settings: {} };
  },
  create: (api) => {
    const toolName = api.settings.toolName ?? "openai_search";
    const model = api.settings.model ?? "gpt-4o";
    const instanceId = api.instance.instanceId;

    return {
      load: async () => {
        api.registrar.registerTool({
          tool: {
            name: toolName,
            description:
              "Search the web using GPT with web search. Returns AI-generated answer with source citations.",
            parameters: searchSchema
          },
          execute: async (args, toolContext, toolCall) => {
            if (!toolContext.permissions.web) {
              throw new Error("Web access not granted. Request web access permission.");
            }
            const payload = args as SearchArgs;

            // Try plugin-specific key first, fallback to OpenAI provider key
            let apiKey = await api.auth.getApiKey(instanceId);
            if (!apiKey) {
              apiKey = await api.auth.getApiKey("openai");
            }
            if (!apiKey) {
              throw new Error(
                "Missing API key. Configure 'openai' provider or run plugin onboarding."
              );
            }

            const response = await fetch("https://api.openai.com/v1/responses", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`
              },
              body: JSON.stringify({
                model,
                tools: [{ type: "web_search" }],
                input: payload.query
              })
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`OpenAI search failed: ${response.status} - ${errorText}`);
            }

            const data = (await response.json()) as OpenAIResponse;

            if (data.error) {
              throw new Error(`OpenAI search failed: ${data.error.message}`);
            }

            // Extract text and annotations from response
            const messageOutput = data.output?.find((o) => o.type === "message");
            const textContent = messageOutput?.content?.find((c) => c.type === "output_text");
            const text = textContent?.text ?? "No results found.";

            // Extract URL annotations for sources
            const annotations = textContent?.annotations ?? [];
            const urlAnnotations = annotations.filter((a) => a.type === "url_citation" && a.url);
            const sources = urlAnnotations
              .map((a, i) => `${i + 1}. ${a.title ?? "Source"}: ${a.url}`)
              .join("\n");

            let finalText = text;
            if (sources) {
              finalText += "\n\nSources:\n" + sources;
            }

            const toolMessage: ToolResultMessage = {
              role: "toolResult",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              content: [{ type: "text", text: finalText }],
              details: { sourcesCount: urlAnnotations.length, model },
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
