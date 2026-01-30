import { createPiAiProviderPlugin } from "../_common/pi-ai-provider/index.js";

export const plugin = createPiAiProviderPlugin({
  id: "mistral",
  label: "Mistral",
  auth: "apiKey"
});
