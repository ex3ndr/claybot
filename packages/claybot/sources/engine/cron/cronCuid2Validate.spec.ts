import { describe, it, expect } from "vitest";

import { cronCuid2Validate } from "./cronCuid2Validate.js";

describe("cronCuid2Validate", () => {
  it("accepts valid 24-char CUID2", () => {
    expect(cronCuid2Validate("abcdefghijklmnopqrstuvwx")).toBe(true);
  });

  it("accepts valid 32-char CUID2", () => {
    expect(cronCuid2Validate("abcdefghijklmnopqrstuvwxyz012345")).toBe(true);
  });

  it("accepts mixed lowercase alphanumeric", () => {
    expect(cronCuid2Validate("abc123def456ghi789jkl012")).toBe(true);
  });

  it("rejects uppercase characters", () => {
    expect(cronCuid2Validate("ABCDEFGHIJKLMNOPQRSTUVWX")).toBe(false);
  });

  it("rejects too short strings", () => {
    expect(cronCuid2Validate("abc123")).toBe(false);
  });

  it("rejects too long strings", () => {
    expect(cronCuid2Validate("abcdefghijklmnopqrstuvwxyz0123456")).toBe(false);
  });

  it("rejects special characters", () => {
    expect(cronCuid2Validate("abc-def-ghi-jkl-mno-pqr")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(cronCuid2Validate("")).toBe(false);
  });
});
