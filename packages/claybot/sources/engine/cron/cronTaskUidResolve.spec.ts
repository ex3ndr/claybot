import { describe, it, expect } from "vitest";

import { cronTaskUidResolve } from "./cronTaskUidResolve.js";

describe("cronTaskUidResolve", () => {
  it("extracts taskId from frontmatter", () => {
    const result = cronTaskUidResolve({ taskId: "abc123def456ghi789jkl012" });
    expect(result).toBe("abc123def456ghi789jkl012");
  });

  it("trims whitespace from taskId", () => {
    const result = cronTaskUidResolve({ taskId: "  abc123  " });
    expect(result).toBe("abc123");
  });

  it("returns null for missing taskId", () => {
    const result = cronTaskUidResolve({ name: "Test" });
    expect(result).toBeNull();
  });

  it("returns null for empty string taskId", () => {
    const result = cronTaskUidResolve({ taskId: "" });
    expect(result).toBeNull();
  });

  it("returns null for whitespace-only taskId", () => {
    const result = cronTaskUidResolve({ taskId: "   " });
    expect(result).toBeNull();
  });

  it("returns null for non-string taskId", () => {
    const result = cronTaskUidResolve({ taskId: 123 });
    expect(result).toBeNull();
  });
});
