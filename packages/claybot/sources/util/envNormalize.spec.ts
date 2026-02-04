import { describe, it, expect } from "vitest";

import { envNormalize } from "./envNormalize.js";

describe("envNormalize", () => {
  it("returns undefined for non-object input", () => {
    expect(envNormalize(null)).toBeUndefined();
    expect(envNormalize("nope")).toBeUndefined();
  });

  it("stringifies primitive values and trims keys", () => {
    expect(
      envNormalize({
        " FOO ": "bar",
        COUNT: 3,
        FLAG: true,
        "": "skip",
        SKIP: { nope: true }
      })
    ).toEqual({
      FOO: "bar",
      COUNT: "3",
      FLAG: "true"
    });
  });

  it("returns undefined when no valid entries", () => {
    expect(envNormalize({})).toBeUndefined();
    expect(envNormalize({ BAD: { nope: true } })).toBeUndefined();
  });
});
