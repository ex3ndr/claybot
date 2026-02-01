import { describe, it, expect } from "vitest";

import { cronSlugify } from "./cronSlugify.js";

describe("cronSlugify", () => {
  it("converts to lowercase", () => {
    expect(cronSlugify("Hello World")).toBe("hello-world");
  });

  it("replaces spaces with hyphens", () => {
    expect(cronSlugify("foo bar baz")).toBe("foo-bar-baz");
  });

  it("removes special characters", () => {
    expect(cronSlugify("Task: Important!")).toBe("task-important");
  });

  it("collapses multiple hyphens", () => {
    expect(cronSlugify("a   b")).toBe("a-b");
  });

  it("trims leading and trailing hyphens", () => {
    expect(cronSlugify("  hello  ")).toBe("hello");
    expect(cronSlugify("---test---")).toBe("test");
  });

  it("handles empty string", () => {
    expect(cronSlugify("")).toBe("");
  });
});
