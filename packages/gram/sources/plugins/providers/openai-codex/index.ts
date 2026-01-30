import { createPiAiProviderPlugin } from "../_common/pi-ai-provider/index.js";

export const plugin = createPiAiProviderPlugin({
  id: "openai-codex",
  label: "OpenAI Codex",
  auth: "oauth"
});
