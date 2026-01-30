import { describe, expect, it, vi } from "vitest";

import { SessionManager } from "./manager.js";

describe("SessionManager", () => {
  it("processes messages sequentially per session", async () => {
    vi.useFakeTimers();

    let counter = 0;
    const seen: string[] = [];
    const manager = new SessionManager({
      idFactory: () => `msg-${(counter += 1)}`
    });

    const context = { channelId: "channel-1", userId: "user-1" };

    const handler = vi.fn(async (_session, entry) => {
      if (entry.message.text === "first") {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      seen.push(entry.message.text ?? "");
    });

    const first = manager.handleMessage(
      "telegram",
      { text: "first" },
      context,
      handler
    );
    const second = manager.handleMessage(
      "telegram",
      { text: "second" },
      context,
      handler
    );

    await vi.advanceTimersByTimeAsync(10);
    await Promise.all([first, second]);

    expect(seen).toEqual(["first", "second"]);

    vi.useRealTimers();
  });

  it("respects explicit session ids", async () => {
    const manager = new SessionManager();
    const context = { channelId: "channel-2", userId: null, sessionId: "shared" };
    let sessionId = "";

    await manager.handleMessage(
      "cron",
      { text: "tick" },
      context,
      (session) => {
        sessionId = session.id;
      }
    );

    expect(sessionId).toBe("shared");
  });
});
