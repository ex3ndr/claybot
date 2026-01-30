import { createPiAiProviderPlugin } from "../_common/pi-ai-provider/index.js";

export const plugin = createPiAiProviderPlugin({
  id: "vercel-ai-gateway",
  label: "Vercel AI Gateway",
  auth: "apiKey"
});
