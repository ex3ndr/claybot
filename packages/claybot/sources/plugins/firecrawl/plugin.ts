import { Type, type Static } from "@sinclair/typebox";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { z } from "zod";

import { definePlugin } from "../../engine/plugins/types.js";

const settingsSchema = z
  .object({
    toolName: z.string().min(1).optional()
  })
  .passthrough();

const fetchSchema = Type.Object(
  {
    url: Type.String({ minLength: 1, description: "The URL to fetch content from" }),
    formats: Type.Optional(
      Type.Array(
        Type.Union([Type.Literal("markdown"), Type.Literal("html"), Type.Literal("rawHtml")]),
        { description: "Output formats: markdown, html, or rawHtml" }
      )
    ),
    onlyMainContent: Type.Optional(
      Type.Boolean({ description: "Whether to extract only the main content" })
    ),
    waitFor: Type.Optional(
      Type.Number({ minimum: 0, maximum: 30000, description: "Time in ms to wait for page load" })
    )
  },
  { additionalProperties: false }
);

type FetchArgs = Static<typeof fetchSchema>;

type FirecrawlResponse = {
  success?: boolean;
  data?: {
    markdown?: string;
    html?: string;
    rawHtml?: string;
    metadata?: {
      title?: string;
      description?: string;
      language?: string;
      sourceURL?: string;
    };
  };
  error?: string;
};

async function validateApiKey(apiKey: string): Promise<void> {
  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      url: "https://example.com",
      formats: ["markdown"],
      onlyMainContent: true
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Firecrawl validation failed: ${response.status} - ${errorText}`);
  }
}

export const plugin = definePlugin({
  settingsSchema,
  onboarding: async (api) => {
    const apiKey = await api.prompt.input({
      message: "Firecrawl API key"
    });
    if (!apiKey) {
      return null;
    }
    await validateApiKey(apiKey);
    await api.auth.setApiKey(api.instanceId, apiKey);
    return { settings: {} };
  },
  create: (api) => {
    const toolName = api.settings.toolName ?? "firecrawl_fetch";
    const instanceId = api.instance.instanceId;

    return {
      load: async () => {
        api.registrar.registerTool({
          tool: {
            name: toolName,
            description:
              "Fetch web page content using Firecrawl. Returns clean markdown or HTML content.",
            parameters: fetchSchema
          },
          execute: async (args, toolContext, toolCall) => {
            if (!toolContext.permissions.web) {
              throw new Error("Web access not granted. Request web access permission.");
            }
            const payload = args as FetchArgs;
            const apiKey = await api.auth.getApiKey(instanceId);
            if (!apiKey) {
              throw new Error("Missing firecrawl apiKey in auth store");
            }

            const requestBody: Record<string, unknown> = {
              url: payload.url,
              formats: payload.formats ?? ["markdown"],
              onlyMainContent: payload.onlyMainContent ?? true
            };

            if (payload.waitFor !== undefined) {
              requestBody.waitFor = payload.waitFor;
            }

            const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`
              },
              body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Firecrawl fetch failed: ${response.status} - ${errorText}`);
            }

            const data = (await response.json()) as FirecrawlResponse;

            if (!data.success) {
              throw new Error(`Firecrawl fetch failed: ${data.error ?? "Unknown error"}`);
            }

            const metadata = data.data?.metadata;
            const title = metadata?.title ?? "Untitled";
            const description = metadata?.description ?? "";

            let text = `Title: ${title}\nURL: ${payload.url}`;
            if (description) {
              text += `\nDescription: ${description}`;
            }
            text += "\n\n---\n\n";

            // prefer markdown, fallback to html, then rawHtml
            const content = data.data?.markdown ?? data.data?.html ?? data.data?.rawHtml;
            if (content) {
              text += content;
            } else {
              text += "No content extracted.";
            }

            const toolMessage: ToolResultMessage = {
              role: "toolResult",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              content: [{ type: "text", text }],
              details: {
                title,
                url: payload.url,
                hasContent: !!content
              },
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
