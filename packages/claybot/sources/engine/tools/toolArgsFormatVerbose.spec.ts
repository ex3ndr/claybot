import { describe, expect, it } from "vitest";

import { toolArgsFormatVerbose } from "./toolArgsFormatVerbose.js";

describe("toolArgsFormatVerbose", () => {
  it("returns empty string for no args", () => {
    expect(toolArgsFormatVerbose({})).toBe("");
  });

  it("formats string args with truncation", () => {
    const value = "a".repeat(120);
    const result = toolArgsFormatVerbose({ name: value });

    expect(result).toContain("name=");
    expect(result.endsWith("...")).toBe(true);
  });
});
