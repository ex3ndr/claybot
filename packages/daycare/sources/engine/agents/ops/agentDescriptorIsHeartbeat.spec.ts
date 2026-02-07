import { describe, expect, it } from "vitest";

import { agentDescriptorIsHeartbeat } from "./agentDescriptorIsHeartbeat.js";

describe("agentDescriptorIsHeartbeat", () => {
  it("matches the heartbeat system tag", () => {
    expect(agentDescriptorIsHeartbeat({ type: "system", tag: "heartbeat" })).toBe(true);
  });

  it("rejects non-heartbeat descriptors", () => {
    expect(agentDescriptorIsHeartbeat({ type: "system", tag: "architect" })).toBe(false);
    expect(
      agentDescriptorIsHeartbeat({
        type: "user",
        connector: "telegram",
        userId: "u1",
        channelId: "c1"
      })
    ).toBe(false);
  });
});
