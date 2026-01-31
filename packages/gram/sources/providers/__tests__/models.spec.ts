import { describe, it, expect } from "vitest";

import { getModels, getProviders } from "@mariozechner/pi-ai";

import { PROVIDER_MODELS } from "../models.js";

function sortIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b));
}

describe("provider model registry", () => {
  it("matches pi-ai provider/model ids", () => {
    const piProviders = sortIds(getProviders());
    const ourProviders = sortIds(Object.keys(PROVIDER_MODELS));
    expect(ourProviders).toEqual(piProviders);

    for (const provider of piProviders) {
      const piIds = sortIds(getModels(provider as never).map((model) => model.id));
      const ourIds = sortIds(
        PROVIDER_MODELS[provider as keyof typeof PROVIDER_MODELS].map((model) => model.id)
      );
      expect(ourIds).toEqual(piIds);
    }
  });
});
