import type { ProviderModelInfo, ProviderModelSize } from "./types.js";

/**
 * Selects a model id matching a preferred size with ordered fallbacks.
 * Expects: models include size metadata; returns null when no match is found.
 */
export function providerModelSelectBySize(
  models: ProviderModelInfo[],
  preferred: ProviderModelSize
): string | null {
  const order = modelSizeOrder(preferred);
  for (const size of order) {
    const match = models.find((model) => model.size === size);
    if (match) {
      return match.id;
    }
  }
  return null;
}

function modelSizeOrder(preferred: ProviderModelSize): ProviderModelSize[] {
  switch (preferred) {
    case "small":
      return ["small", "normal", "large", "unknown"];
    case "normal":
      return ["normal", "large", "small", "unknown"];
    case "large":
      return ["large", "normal", "small", "unknown"];
    case "unknown":
      return ["unknown", "normal", "large", "small"];
  }
}
