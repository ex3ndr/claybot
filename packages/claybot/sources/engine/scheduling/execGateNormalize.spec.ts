import { describe, it, expect } from "vitest";

import { execGateNormalize } from "./execGateNormalize.js";

describe("execGateNormalize", () => {
  it("returns undefined for missing command", () => {
    expect(execGateNormalize(null)).toBeUndefined();
    expect(execGateNormalize({})).toBeUndefined();
  });

  it("normalizes gate fields", () => {
    const result = execGateNormalize({
      command: "  echo ok  ",
      cwd: " /tmp ",
      timeoutMs: 1500,
      env: { FOO: "bar", SKIP: 3, FLAG: true },
      permissions: ["@web", "  @read:/tmp  ", "", "@web"],
      allowedDomains: ["example.com", " example.com "]
    });
    expect(result).toEqual({
      command: "echo ok",
      cwd: "/tmp",
      timeoutMs: 1500,
      env: { FOO: "bar", SKIP: "3", FLAG: "true" },
      permissions: ["@web", "@read:/tmp"],
      allowedDomains: ["example.com"]
    });
  });
});
