import { describe, expect, it } from "vitest";

import { getLogger } from "../../log.js";
import { sessionKeyResolve } from "./sessionKeyResolve.js";

const logger = getLogger("test.session-key-resolve");

describe("sessionKeyResolve", () => {
  it("resolves cron keys from task uids", () => {
    const result = sessionKeyResolve(
      "cron",
      {
        channelId: "channel",
        userId: "cron",
        cron: {
          taskId: "task",
          taskUid: "a".repeat(24),
          taskName: "Task",
          memoryPath: "/tmp/memory.md",
          filesPath: "/tmp/files"
        }
      },
      logger
    );

    expect(result).toBe(`cron:${"a".repeat(24)}`);
  });

  it("resolves heartbeat keys", () => {
    const result = sessionKeyResolve(
      "heartbeat",
      { channelId: "channel", userId: "heartbeat", heartbeat: {} },
      logger
    );

    expect(result).toBe("heartbeat");
  });

  it("resolves user keys", () => {
    const result = sessionKeyResolve(
      "slack",
      { channelId: "channel", userId: "user" },
      logger
    );

    expect(result).toBe("user:slack:channel:user");
  });

  it("returns null for system sources", () => {
    const result = sessionKeyResolve(
      "system",
      { channelId: "channel", userId: "user" },
      logger
    );

    expect(result).toBeNull();
  });
});
