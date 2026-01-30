import { createPiAiProviderPlugin } from "../_common/pi-ai-provider/index.js";

export const plugin = createPiAiProviderPlugin({
  id: "github-copilot",
  label: "GitHub Copilot",
  auth: "oauth"
});
