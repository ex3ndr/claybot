import { describe, expect, it } from "vitest";

import { AgentInbox } from "./agentInbox.js";

const buildReset = () => ({ type: "reset" as const, source: "system" });

describe("AgentInbox", () => {
  it("delivers queued entries in order", async () => {
    const inbox = new AgentInbox("agent-1");
    const first = inbox.post(buildReset());
    const second = inbox.post(buildReset());

    const entry1 = await inbox.next();
    const entry2 = await inbox.next();

    expect(entry1.id).toBe(first.id);
    expect(entry2.id).toBe(second.id);
  });

  it("awaits until an entry is posted", async () => {
    const inbox = new AgentInbox("agent-2");
    const pending = inbox.next();
    const posted = inbox.post(buildReset());
    const entry = await pending;

    expect(entry.id).toBe(posted.id);
  });
});
