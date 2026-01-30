export type ProviderAuth = "apiKey" | "oauth" | "mixed" | "none";
export type ProviderKind = "pi-ai" | "openai-compatible";

export type ProviderDefinition = {
  id: string;
  label: string;
  auth: ProviderAuth;
  kind: ProviderKind;
  optionalApiKey?: boolean;
};

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  { id: "openai", label: "OpenAI", auth: "apiKey", kind: "pi-ai" },
  { id: "anthropic", label: "Anthropic", auth: "mixed", kind: "pi-ai" },
  { id: "google", label: "Google", auth: "apiKey", kind: "pi-ai" },
  {
    id: "azure-openai-responses",
    label: "Azure OpenAI (Responses)",
    auth: "apiKey",
    kind: "pi-ai"
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    auth: "apiKey",
    kind: "openai-compatible",
    optionalApiKey: true
  },
  { id: "openrouter", label: "OpenRouter", auth: "apiKey", kind: "pi-ai" },
  { id: "mistral", label: "Mistral", auth: "apiKey", kind: "pi-ai" },
  { id: "groq", label: "Groq", auth: "apiKey", kind: "pi-ai" },
  { id: "xai", label: "xAI", auth: "apiKey", kind: "pi-ai" },
  { id: "amazon-bedrock", label: "Amazon Bedrock", auth: "none", kind: "pi-ai" },
  { id: "google-vertex", label: "Vertex AI", auth: "none", kind: "pi-ai" },
  {
    id: "vercel-ai-gateway",
    label: "Vercel AI Gateway",
    auth: "apiKey",
    kind: "pi-ai"
  },
  { id: "github-copilot", label: "GitHub Copilot", auth: "oauth", kind: "pi-ai" },
  { id: "openai-codex", label: "OpenAI Codex", auth: "oauth", kind: "pi-ai" },
  { id: "google-gemini-cli", label: "Google Gemini CLI", auth: "oauth", kind: "pi-ai" },
  { id: "google-antigravity", label: "Antigravity", auth: "oauth", kind: "pi-ai" },
  { id: "minimax", label: "MiniMax", auth: "apiKey", kind: "pi-ai" },
  { id: "cerebras", label: "Cerebras", auth: "apiKey", kind: "pi-ai" },
  { id: "kimi-coding", label: "Kimi For Coding", auth: "apiKey", kind: "pi-ai" }
];

export function getProviderDefinition(id: string): ProviderDefinition | null {
  return PROVIDER_DEFINITIONS.find((provider) => provider.id === id) ?? null;
}
