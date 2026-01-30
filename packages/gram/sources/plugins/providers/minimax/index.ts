import { createPiAiProviderPlugin } from "../_common/pi-ai-provider/index.js";

export const plugin = createPiAiProviderPlugin({
  id: "minimax",
  label: "MiniMax",
  auth: "apiKey"
});
