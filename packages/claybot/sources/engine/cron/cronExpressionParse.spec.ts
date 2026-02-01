import { describe, it, expect } from "vitest";

import { cronExpressionParse } from "./cronExpressionParse.js";

describe("cronExpressionParse", () => {
  it("parses wildcard expression", () => {
    const result = cronExpressionParse("* * * * *");
    expect(result).not.toBeNull();
    expect(result!.minute.any).toBe(true);
    expect(result!.hour.any).toBe(true);
    expect(result!.day.any).toBe(true);
    expect(result!.month.any).toBe(true);
    expect(result!.weekday.any).toBe(true);
  });

  it("parses specific values", () => {
    const result = cronExpressionParse("30 9 * * *");
    expect(result).not.toBeNull();
    expect(result!.minute.values.has(30)).toBe(true);
    expect(result!.hour.values.has(9)).toBe(true);
  });

  it("parses step values", () => {
    const result = cronExpressionParse("*/15 * * * *");
    expect(result).not.toBeNull();
    expect(result!.minute.values.has(0)).toBe(true);
    expect(result!.minute.values.has(15)).toBe(true);
    expect(result!.minute.values.has(30)).toBe(true);
    expect(result!.minute.values.has(45)).toBe(true);
  });

  it("parses ranges", () => {
    const result = cronExpressionParse("* 9-17 * * *");
    expect(result).not.toBeNull();
    expect(result!.hour.values.size).toBe(9);
    expect(result!.hour.values.has(9)).toBe(true);
    expect(result!.hour.values.has(17)).toBe(true);
  });

  it("parses comma-separated values", () => {
    const result = cronExpressionParse("0,30 * * * *");
    expect(result).not.toBeNull();
    expect(result!.minute.values.size).toBe(2);
    expect(result!.minute.values.has(0)).toBe(true);
    expect(result!.minute.values.has(30)).toBe(true);
  });

  it("parses weekday", () => {
    const result = cronExpressionParse("0 9 * * 1");
    expect(result).not.toBeNull();
    expect(result!.weekday.values.has(1)).toBe(true);
  });

  it("returns null for too few fields", () => {
    expect(cronExpressionParse("* * *")).toBeNull();
  });

  it("returns null for too many fields", () => {
    expect(cronExpressionParse("* * * * * *")).toBeNull();
  });

  it("returns null for invalid minute", () => {
    expect(cronExpressionParse("60 * * * *")).toBeNull();
  });

  it("returns null for invalid hour", () => {
    expect(cronExpressionParse("* 24 * * *")).toBeNull();
  });

  it("returns null for invalid day", () => {
    expect(cronExpressionParse("* * 32 * *")).toBeNull();
    expect(cronExpressionParse("* * 0 * *")).toBeNull();
  });

  it("returns null for invalid month", () => {
    expect(cronExpressionParse("* * * 13 *")).toBeNull();
    expect(cronExpressionParse("* * * 0 *")).toBeNull();
  });

  it("returns null for invalid weekday", () => {
    expect(cronExpressionParse("* * * * 7")).toBeNull();
  });

  it("returns null for invalid expression", () => {
    expect(cronExpressionParse("invalid")).toBeNull();
  });
});
