import { describe, expect, it } from "vitest";

import { agentDescriptorTargetResolve } from "./agentDescriptorTargetResolve.js";

describe("agentDescriptorTargetResolve", () => {
  it("returns connector target for user descriptors", () => {
    const result = agentDescriptorTargetResolve({
      type: "user",
      connector: "telegram",
      userId: "user-1",
      channelId: "channel-1"
    });

    expect(result).toEqual({ connector: "telegram", targetId: "channel-1" });
  });

  it("returns null for non-user descriptors", () => {
    const result = agentDescriptorTargetResolve({ type: "heartbeat" });

    expect(result).toBeNull();
  });
});
