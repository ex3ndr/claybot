import { describe, it, expect } from "vitest";

import { cronFieldMatch } from "./cronFieldMatch.js";
import type { CronField } from "./cronTypes.js";

describe("cronFieldMatch", () => {
  it("matches any field with any value", () => {
    const field: CronField = { values: new Set(), any: true };
    expect(cronFieldMatch(field, 0)).toBe(true);
    expect(cronFieldMatch(field, 30)).toBe(true);
    expect(cronFieldMatch(field, 59)).toBe(true);
  });

  it("matches specific values", () => {
    const field: CronField = { values: new Set([0, 15, 30, 45]), any: false };
    expect(cronFieldMatch(field, 0)).toBe(true);
    expect(cronFieldMatch(field, 15)).toBe(true);
    expect(cronFieldMatch(field, 30)).toBe(true);
    expect(cronFieldMatch(field, 45)).toBe(true);
  });

  it("does not match non-included values", () => {
    const field: CronField = { values: new Set([0, 15, 30, 45]), any: false };
    expect(cronFieldMatch(field, 1)).toBe(false);
    expect(cronFieldMatch(field, 10)).toBe(false);
    expect(cronFieldMatch(field, 59)).toBe(false);
  });

  it("handles empty value set (not any)", () => {
    const field: CronField = { values: new Set(), any: false };
    expect(cronFieldMatch(field, 0)).toBe(false);
    expect(cronFieldMatch(field, 30)).toBe(false);
  });
});
