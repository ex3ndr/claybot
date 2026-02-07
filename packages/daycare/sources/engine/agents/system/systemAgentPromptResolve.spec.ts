import { describe, expect, it } from "vitest";

import { systemAgentPromptResolve } from "./systemAgentPromptResolve.js";

describe("systemAgentPromptResolve", () => {
  it("resolves heartbeat prompt without replacing base system prompt", async () => {
    const heartbeat = await systemAgentPromptResolve("heartbeat");
    expect(heartbeat?.tag).toBe("heartbeat");
    expect(heartbeat?.systemPrompt.length).toBeGreaterThan(0);
    expect(heartbeat?.replaceSystemPrompt).toBe(false);
  });

  it("resolves architect prompt with full prompt replacement enabled", async () => {
    const architect = await systemAgentPromptResolve("architect");
    expect(architect?.tag).toBe("architect");
    expect(architect?.systemPrompt.length).toBeGreaterThan(0);
    expect(architect?.replaceSystemPrompt).toBe(true);
  });

  it("returns null for unknown tags", async () => {
    await expect(systemAgentPromptResolve("unknown")).resolves.toBeNull();
  });
});
