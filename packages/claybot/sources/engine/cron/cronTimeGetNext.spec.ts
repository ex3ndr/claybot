import { describe, it, expect } from "vitest";

import { cronTimeGetNext } from "./cronTimeGetNext.js";

describe("cronTimeGetNext", () => {
  it("returns next minute for every-minute schedule", () => {
    const from = new Date(2024, 0, 15, 10, 30, 45); // Local time
    const next = cronTimeGetNext("* * * * *", from);

    expect(next).not.toBeNull();
    expect(next!.getMinutes()).toBe(31);
    expect(next!.getSeconds()).toBe(0);
  });

  it("returns next matching hour", () => {
    const from = new Date(2024, 0, 15, 10, 30, 0); // Local time
    const next = cronTimeGetNext("0 12 * * *", from);

    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(12);
    expect(next!.getMinutes()).toBe(0);
  });

  it("returns next day if hour passed", () => {
    // Use local time to avoid timezone issues
    const from = new Date(2024, 0, 15, 14, 30, 0); // Jan 15, 2024, 14:30 local
    const next = cronTimeGetNext("0 9 * * *", from);

    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(16);
    expect(next!.getHours()).toBe(9);
  });

  it("handles weekday constraints", () => {
    // Friday Jan 19, 2024
    const from = new Date("2024-01-19T10:00:00Z");
    // Schedule for Monday (1)
    const next = cronTimeGetNext("0 9 * * 1", from);

    expect(next).not.toBeNull();
    expect(next!.getDay()).toBe(1); // Monday
  });

  it("handles step values", () => {
    const from = new Date(2024, 0, 15, 10, 32, 0);
    const next = cronTimeGetNext("*/15 * * * *", from);

    expect(next).not.toBeNull();
    expect(next!.getMinutes()).toBe(45);
  });

  it("handles specific day of month", () => {
    const from = new Date(2024, 0, 15, 10, 0, 0);
    const next = cronTimeGetNext("0 12 20 * *", from);

    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(20);
  });

  it("handles month constraint", () => {
    const from = new Date(2024, 0, 15, 10, 0, 0); // January
    const next = cronTimeGetNext("0 0 1 6 *", from); // June 1st

    expect(next).not.toBeNull();
    expect(next!.getMonth()).toBe(5); // June (0-indexed)
    expect(next!.getDate()).toBe(1);
  });

  it("returns null for invalid expression", () => {
    expect(cronTimeGetNext("invalid")).toBeNull();
  });

  it("uses current time when from is not provided", () => {
    const before = new Date();
    const next = cronTimeGetNext("* * * * *");
    const after = new Date();

    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(before.getTime());
    // Next should be within ~2 minutes of now
    expect(next!.getTime()).toBeLessThan(after.getTime() + 2 * 60 * 1000);
  });
});
