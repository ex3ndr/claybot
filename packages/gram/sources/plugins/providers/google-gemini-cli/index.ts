import { createPiAiProviderPlugin } from "../_common/pi-ai-provider/index.js";

export const plugin = createPiAiProviderPlugin({
  id: "google-gemini-cli",
  label: "Google Gemini CLI",
  auth: "oauth"
});
