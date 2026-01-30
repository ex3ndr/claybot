import { createPiAiProviderDefinition } from "./pi-ai.js";
import { openAiCompatibleProvider } from "./openai-compatible.js";
import { buildOpenAiImageProvider } from "./openai-image.js";
import { nanobananaProvider } from "./nanobanana.js";

import type { ProviderDefinition } from "./types.js";
import type { ProviderSettings, SettingsConfig } from "../settings.js";
import { listActiveProviders } from "../settings.js";

const PROVIDERS: ProviderDefinition[] = [
  createPiAiProviderDefinition({
    id: "openai",
    name: "OpenAI",
    description: "OpenAI inference provider.",
    auth: "apiKey",
    imageProvider: buildOpenAiImageProvider
  }),
  openAiCompatibleProvider,
  createPiAiProviderDefinition({
    id: "anthropic",
    name: "Anthropic",
    description: "Anthropic inference provider.",
    auth: "mixed"
  }),
  createPiAiProviderDefinition({
    id: "google",
    name: "Google",
    description: "Google inference provider.",
    auth: "apiKey"
  }),
  createPiAiProviderDefinition({
    id: "openrouter",
    name: "OpenRouter",
    description: "OpenRouter inference provider.",
    auth: "apiKey"
  }),
  createPiAiProviderDefinition({
    id: "groq",
    name: "Groq",
    description: "Groq inference provider.",
    auth: "apiKey"
  }),
  createPiAiProviderDefinition({
    id: "mistral",
    name: "Mistral",
    description: "Mistral inference provider.",
    auth: "apiKey"
  }),
  createPiAiProviderDefinition({
    id: "xai",
    name: "xAI",
    description: "xAI inference provider.",
    auth: "apiKey"
  }),
  createPiAiProviderDefinition({
    id: "azure-openai-responses",
    name: "Azure OpenAI (Responses)",
    description: "Azure OpenAI Responses provider.",
    auth: "apiKey"
  }),
  createPiAiProviderDefinition({
    id: "github-copilot",
    name: "GitHub Copilot",
    description: "GitHub Copilot inference provider.",
    auth: "oauth"
  }),
  createPiAiProviderDefinition({
    id: "openai-codex",
    name: "OpenAI Codex",
    description: "OpenAI Codex inference provider.",
    auth: "oauth"
  }),
  createPiAiProviderDefinition({
    id: "google-gemini-cli",
    name: "Google Gemini CLI",
    description: "Google Gemini CLI inference provider.",
    auth: "oauth"
  }),
  createPiAiProviderDefinition({
    id: "google-antigravity",
    name: "Antigravity",
    description: "Google Antigravity inference provider.",
    auth: "oauth"
  }),
  createPiAiProviderDefinition({
    id: "amazon-bedrock",
    name: "Amazon Bedrock",
    description: "Amazon Bedrock inference provider.",
    auth: "none"
  }),
  createPiAiProviderDefinition({
    id: "google-vertex",
    name: "Vertex AI",
    description: "Vertex AI inference provider.",
    auth: "none"
  }),
  createPiAiProviderDefinition({
    id: "vercel-ai-gateway",
    name: "Vercel AI Gateway",
    description: "Vercel AI Gateway inference provider.",
    auth: "apiKey"
  }),
  createPiAiProviderDefinition({
    id: "cerebras",
    name: "Cerebras",
    description: "Cerebras inference provider.",
    auth: "apiKey"
  }),
  createPiAiProviderDefinition({
    id: "minimax",
    name: "MiniMax",
    description: "MiniMax inference provider.",
    auth: "apiKey"
  }),
  createPiAiProviderDefinition({
    id: "kimi-coding",
    name: "Kimi For Coding",
    description: "Kimi inference provider.",
    auth: "apiKey"
  }),
  nanobananaProvider
];

export function listProviderDefinitions(): ProviderDefinition[] {
  return [...PROVIDERS];
}

export function getProviderDefinition(id: string): ProviderDefinition | null {
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

export function listActiveInferenceProviders(settings: SettingsConfig): ProviderSettings[] {
  const active = listActiveProviders(settings);
  const inferenceIds = new Set(
    PROVIDERS.filter((provider) => provider.capabilities.inference).map((provider) => provider.id)
  );
  return active.filter((provider) => inferenceIds.has(provider.id));
}
