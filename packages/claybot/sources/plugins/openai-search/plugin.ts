import { Type, type Static } from "@sinclair/typebox";
import { getOAuthApiKey, type OAuthCredentials, type OAuthProviderId } from "@mariozechner/pi-ai";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { z } from "zod";

import { definePlugin } from "../../engine/plugins/types.js";
import type { AuthEntry, AuthStore } from "../../auth/store.js";

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

function stripOAuth(entry: AuthEntry): OAuthCredentials {
  const { type: _type, ...rest } = entry;
  return rest as OAuthCredentials;
}

async function resolveOAuthApiKey(
  auth: AuthStore,
  providerId: OAuthProviderId,
  entry: AuthEntry
): Promise<string | null> {
  if (entry.type !== "oauth") {
    return null;
  }
  const result = await getOAuthApiKey(providerId, {
    [providerId]: stripOAuth(entry)
  });
  if (!result) {
    return null;
  }
  await auth.setOAuth(providerId, result.newCredentials as Record<string, unknown>);
  return result.apiKey;
}

async function resolveOpenAiApiKey(
  auth: AuthStore,
  instanceId: string
): Promise<string | null> {
  const instanceKey = await auth.getApiKey(instanceId);
  if (instanceKey) {
    return instanceKey;
  }

  const providerKey = await auth.getApiKey("openai");
  if (providerKey) {
    return providerKey;
  }

  const codexEntry = await auth.getEntry("openai-codex");
  if (codexEntry?.type === "oauth") {
    return resolveOAuthApiKey(auth, "openai-codex", codexEntry);
  }

  return null;
}

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
    const instanceKey = await api.auth.getApiKey(api.instanceId);
    if (instanceKey) {
      try {
        await validateApiKey(instanceKey);
        api.note("Using existing OpenAI instance credentials.", "Setup");
        return { settings: {} };
      } catch (error) {
        api.note("Existing OpenAI instance key failed validation, prompting for a new key.", "Setup");
      }
    }

    const providerKey = await api.auth.getApiKey("openai");
    if (providerKey) {
      try {
        await validateApiKey(providerKey);
        api.note("Using existing OpenAI provider credentials.", "Setup");
        return { settings: {} };
      } catch (error) {
        api.note("Existing OpenAI provider key failed validation, prompting for a new key.", "Setup");
      }
    }

    const codexEntry = await api.auth.getEntry("openai-codex");
    if (codexEntry?.type === "oauth") {
      try {
        const oauthKey = await resolveOAuthApiKey(api.auth, "openai-codex", codexEntry);
        if (oauthKey) {
          await validateApiKey(oauthKey);
          api.note("Using existing OpenAI Codex subscription credentials.", "Setup");
          return { settings: {} };
        }
        api.note(
          "OpenAI Codex subscription credentials are missing or expired, prompting for a new key.",
          "Setup"
        );
      } catch (error) {
        api.note(
          "Existing OpenAI Codex subscription credentials failed validation, prompting for a new key.",
          "Setup"
        );
      }
    }

    // Fallback: prompt for API key if OpenAI provider not configured or invalid
    const apiKey = await api.prompt.input({
      message: "OpenAI API key (or configure 'openai' or 'openai-codex' provider first)"
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

            // Try plugin-specific key first, fallback to OpenAI provider or Codex OAuth
            const apiKey = await resolveOpenAiApiKey(api.auth, instanceId);
            if (!apiKey) {
              throw new Error(
                "Missing API key. Configure 'openai' or 'openai-codex' provider or run plugin onboarding."
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
