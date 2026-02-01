import { describe, it, expect } from "vitest";

import { cronFieldParse } from "./cronFieldParse.js";

describe("cronFieldParse", () => {
  it("parses wildcard", () => {
    const result = cronFieldParse("*", 0, 59);
    expect(result).not.toBeNull();
    expect(result!.any).toBe(true);
    expect(result!.values.size).toBe(0);
  });

  it("parses single value", () => {
    const result = cronFieldParse("30", 0, 59);
    expect(result).not.toBeNull();
    expect(result!.any).toBe(false);
    expect(result!.values.has(30)).toBe(true);
  });

  it("parses step values", () => {
    const result = cronFieldParse("*/15", 0, 59);
    expect(result).not.toBeNull();
    expect(result!.values.has(0)).toBe(true);
    expect(result!.values.has(15)).toBe(true);
    expect(result!.values.has(30)).toBe(true);
    expect(result!.values.has(45)).toBe(true);
    expect(result!.values.size).toBe(4);
  });

  it("parses ranges", () => {
    const result = cronFieldParse("9-17", 0, 23);
    expect(result).not.toBeNull();
    expect(result!.values.size).toBe(9);
    expect(result!.values.has(9)).toBe(true);
    expect(result!.values.has(17)).toBe(true);
  });

  it("parses comma-separated values", () => {
    const result = cronFieldParse("0,30", 0, 59);
    expect(result).not.toBeNull();
    expect(result!.values.size).toBe(2);
    expect(result!.values.has(0)).toBe(true);
    expect(result!.values.has(30)).toBe(true);
  });

  it("parses mixed comma and range", () => {
    const result = cronFieldParse("1-3,10,20-22", 0, 59);
    expect(result).not.toBeNull();
    expect(result!.values.size).toBe(7);
    expect([...result!.values].sort((a, b) => a - b)).toEqual([1, 2, 3, 10, 20, 21, 22]);
  });

  it("returns null for out-of-range value", () => {
    expect(cronFieldParse("60", 0, 59)).toBeNull();
    expect(cronFieldParse("-1", 0, 59)).toBeNull();
  });

  it("returns null for invalid range", () => {
    expect(cronFieldParse("10-5", 0, 59)).toBeNull();
    expect(cronFieldParse("0-60", 0, 59)).toBeNull();
  });

  it("returns null for invalid step", () => {
    expect(cronFieldParse("*/0", 0, 59)).toBeNull();
    expect(cronFieldParse("*/-1", 0, 59)).toBeNull();
    expect(cronFieldParse("*/abc", 0, 59)).toBeNull();
  });

  it("returns null for non-numeric value", () => {
    expect(cronFieldParse("abc", 0, 59)).toBeNull();
  });
});
