import { createPiAiProviderPlugin } from "../_common/pi-ai-provider/index.js";

export const plugin = createPiAiProviderPlugin({
  id: "azure-openai-responses",
  label: "Azure OpenAI (Responses)",
  auth: "apiKey"
});
