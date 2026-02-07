import { describe, expect, it } from "vitest";

import { systemAgentTagIs } from "./systemAgentTagIs.js";

describe("systemAgentTagIs", () => {
  it("accepts lowercase english tags", () => {
    expect(systemAgentTagIs("heartbeat")).toBe(true);
    expect(systemAgentTagIs("architect")).toBe(true);
  });

  it("rejects non-lowercase tags", () => {
    expect(systemAgentTagIs("HeartBeat")).toBe(false);
    expect(systemAgentTagIs("architect-v2")).toBe(false);
    expect(systemAgentTagIs(" architect ")).toBe(true);
  });
});
