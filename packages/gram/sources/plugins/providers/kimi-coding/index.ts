import { createPiAiProviderPlugin } from "../_common/pi-ai-provider/index.js";

export const plugin = createPiAiProviderPlugin({
  id: "kimi-coding",
  label: "Kimi For Coding",
  auth: "apiKey"
});
