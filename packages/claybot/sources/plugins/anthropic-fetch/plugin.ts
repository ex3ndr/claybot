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

const fetchSchema = Type.Object(
  {
    url: Type.String({ minLength: 1, description: "The URL to fetch content from" }),
    instruction: Type.Optional(
      Type.String({ description: "Optional instruction for how to process the content" })
    )
  },
  { additionalProperties: false }
);

type FetchArgs = Static<typeof fetchSchema>;

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "web_search_tool_result"; tool_use_id: string; content: unknown };

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
  error?: {
    message?: string;
  };
};

export const plugin = definePlugin({
  settingsSchema,
  onboarding: async (api) => {
    // Reuses existing Anthropic provider credentials
    const existingKey = await api.auth.getApiKey("anthropic");
    if (existingKey) {
      api.note("Using existing Anthropic provider credentials.", "Setup");
      return { settings: {} };
    }
    // Fallback: prompt for API key if Anthropic provider not configured
    const apiKey = await api.prompt.input({
      message: "Anthropic API key (or configure 'anthropic' provider first)"
    });
    if (!apiKey) {
      return null;
    }
    await api.auth.setApiKey(api.instanceId, apiKey);
    return { settings: {} };
  },
  create: (api) => {
    const toolName = api.settings.toolName ?? "anthropic_fetch";
    const model = api.settings.model ?? "claude-sonnet-4-20250514";
    const instanceId = api.instance.instanceId;

    return {
      load: async () => {
        api.registrar.registerTool({
          tool: {
            name: toolName,
            description:
              "Fetch and process web page content using Claude with web search. Returns extracted and summarized content.",
            parameters: fetchSchema
          },
          execute: async (args, toolContext, toolCall) => {
            if (!toolContext.permissions.web) {
              throw new Error("Web access not granted. Request web access permission.");
            }
            const payload = args as FetchArgs;

            // Try plugin-specific key first, fallback to Anthropic provider key
            let apiKey = await api.auth.getApiKey(instanceId);
            if (!apiKey) {
              apiKey = await api.auth.getApiKey("anthropic");
            }
            if (!apiKey) {
              throw new Error(
                "Missing API key. Configure 'anthropic' provider or run plugin onboarding."
              );
            }

            const instruction = payload.instruction ?? "Extract and summarize the main content";
            const prompt = `Fetch the content from this URL and ${instruction}: ${payload.url}`;

            const response = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01"
              },
              body: JSON.stringify({
                model,
                max_tokens: 8192,
                tools: [
                  {
                    type: "web_search_20250305",
                    name: "web_search",
                    max_uses: 1
                  }
                ],
                messages: [
                  {
                    role: "user",
                    content: prompt
                  }
                ]
              })
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Anthropic fetch failed: ${response.status} - ${errorText}`);
            }

            const data = (await response.json()) as AnthropicResponse;

            if (data.error) {
              throw new Error(`Anthropic fetch failed: ${data.error.message}`);
            }

            // Extract text content from response
            const textBlocks =
              data.content?.filter((block): block is { type: "text"; text: string } => block.type === "text") ?? [];
            let text = textBlocks.map((block) => block.text).join("\n\n") || "No content extracted.";

            // Prepend URL info
            text = `URL: ${payload.url}\n\n---\n\n${text}`;

            const toolMessage: ToolResultMessage = {
              role: "toolResult",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              content: [{ type: "text", text }],
              details: { url: payload.url, model },
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
