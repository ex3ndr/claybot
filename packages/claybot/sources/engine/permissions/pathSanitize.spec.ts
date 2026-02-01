import { describe, it, expect } from "vitest";
import { pathSanitize, pathSanitizeAndResolve } from "./pathSanitize.js";

describe("pathSanitize", () => {
  it("accepts valid paths", () => {
    expect(() => pathSanitize("/home/user/file.txt")).not.toThrow();
    expect(() => pathSanitize("/path/with spaces/file.txt")).not.toThrow();
    expect(() => pathSanitize("/unicode/日本語/文件.txt")).not.toThrow();
  });

  it("rejects paths with null bytes", () => {
    expect(() => pathSanitize("/home/user\x00/malicious")).toThrow(
      "Path contains null byte."
    );
    expect(() => pathSanitize("/etc/passwd\x00.txt")).toThrow(
      "Path contains null byte."
    );
  });

  it("rejects paths with control characters", () => {
    expect(() => pathSanitize("/home/user\x01file")).toThrow(
      "Path contains invalid control character."
    );
    expect(() => pathSanitize("/home/user\x1Ffile")).toThrow(
      "Path contains invalid control character."
    );
  });

  it("allows tabs and newlines", () => {
    // Tabs and newlines are uncommon but not dangerous in the same way
    expect(() => pathSanitize("/home/user\tfile")).not.toThrow();
    expect(() => pathSanitize("/home/user\nfile")).not.toThrow();
  });

  it("rejects excessively long paths", () => {
    const longPath = "/" + "a".repeat(5000);
    expect(() => pathSanitize(longPath)).toThrow(
      "Path exceeds maximum length of 4096 characters."
    );
  });

  it("accepts paths at the limit", () => {
    const maxPath = "/" + "a".repeat(4095);
    expect(() => pathSanitize(maxPath)).not.toThrow();
  });
});

describe("pathSanitizeAndResolve", () => {
  it("sanitizes and resolves valid absolute paths", () => {
    const result = pathSanitizeAndResolve("/home/user/../user/file.txt");
    expect(result).toBe("/home/user/file.txt");
  });

  it("rejects relative paths", () => {
    expect(() => pathSanitizeAndResolve("relative/path")).toThrow(
      "Path must be absolute."
    );
  });

  it("rejects paths with null bytes before checking absolute", () => {
    expect(() => pathSanitizeAndResolve("/etc/passwd\x00")).toThrow(
      "Path contains null byte."
    );
  });
});
