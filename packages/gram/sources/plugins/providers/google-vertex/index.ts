import { createPiAiProviderPlugin } from "../_common/pi-ai-provider/index.js";

export const plugin = createPiAiProviderPlugin({
  id: "google-vertex",
  label: "Vertex AI",
  auth: "none"
});
