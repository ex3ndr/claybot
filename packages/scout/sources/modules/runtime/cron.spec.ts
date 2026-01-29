import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CronScheduler } from "./cron.js";

describe("CronScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispatches tasks on start and interval", async () => {
    const received: string[] = [];
    const cron = new CronScheduler({
      tasks: [
        {
          id: "tick",
          everyMs: 1000,
          message: "ping",
          runOnStart: true,
          channelId: "session-a"
        }
      ],
      onMessage: (message, context) => {
        received.push(`${context.channelId}:${message.text ?? ""}`);
      }
    });

    cron.start();
    await vi.runAllTicks();
    expect(received).toEqual(["session-a:ping"]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(received).toEqual(["session-a:ping", "session-a:ping", "session-a:ping"]);

    cron.stop();
  });

  it("runs one-off tasks only once", async () => {
    const received: string[] = [];
    const cron = new CronScheduler({
      tasks: [
        {
          id: "once",
          everyMs: 500,
          message: "only-once",
          once: true,
          channelId: "session-b"
        }
      ],
      onMessage: (message, context) => {
        received.push(`${context.channelId}:${message.text ?? ""}`);
      }
    });

    cron.start();
    await vi.runAllTicks();
    expect(received).toEqual([]);

    await vi.advanceTimersByTimeAsync(500);
    expect(received).toEqual(["session-b:only-once"]);

    await vi.advanceTimersByTimeAsync(1500);
    expect(received).toEqual(["session-b:only-once"]);

    cron.stop();
  });

  it("invokes custom actions when configured", async () => {
    const action = vi.fn();
    const cron = new CronScheduler({
      tasks: [
        {
          id: "custom",
          everyMs: 250,
          action: "do-work",
          payload: { job: "cleanup" }
        }
      ],
      actions: {
        "do-work": action
      },
      onMessage: vi.fn()
    });

    cron.start();
    await vi.advanceTimersByTimeAsync(250);

    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { job: "cleanup" } }),
      expect.objectContaining({ channelId: "cron:custom" })
    );

    cron.stop();
  });
});
