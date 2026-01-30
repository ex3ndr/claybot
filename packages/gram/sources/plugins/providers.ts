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
  }
];

export function getProviderDefinition(id: string): ProviderDefinition | null {
  return PROVIDER_DEFINITIONS.find((provider) => provider.id === id) ?? null;
}
