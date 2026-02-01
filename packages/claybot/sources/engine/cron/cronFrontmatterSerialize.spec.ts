import { describe, it, expect } from "vitest";

import { cronFrontmatterSerialize } from "./cronFrontmatterSerialize.js";

describe("cronFrontmatterSerialize", () => {
  it("serializes frontmatter and body", () => {
    const frontmatter = {
      name: "Test Task",
      schedule: "* * * * *",
      enabled: true
    };
    const body = "Do something.";

    const result = cronFrontmatterSerialize(frontmatter, body);

    expect(result).toContain("---");
    expect(result).toContain("name: Test Task");
    expect(result).toContain("schedule: * * * * *");
    expect(result).toContain("enabled: true");
    expect(result).toContain("Do something.");
  });

  it("quotes strings with colons", () => {
    const frontmatter = { name: "Task: Important" };
    const result = cronFrontmatterSerialize(frontmatter, "");

    expect(result).toContain('name: "Task: Important"');
  });

  it("quotes strings with newlines", () => {
    const frontmatter = { desc: "line1\nline2" };
    const result = cronFrontmatterSerialize(frontmatter, "");

    expect(result).toContain('desc: "line1\nline2"');
  });

  it("escapes double quotes", () => {
    const frontmatter = { name: 'Say "hello"' };
    const result = cronFrontmatterSerialize(frontmatter, "");

    expect(result).toContain('name: "Say \\"hello\\""');
  });

  it("serializes numeric values", () => {
    const frontmatter = { count: 42 };
    const result = cronFrontmatterSerialize(frontmatter, "");

    expect(result).toContain("count: 42");
  });

  it("serializes boolean values", () => {
    const frontmatter = { enabled: true, disabled: false };
    const result = cronFrontmatterSerialize(frontmatter, "");

    expect(result).toContain("enabled: true");
    expect(result).toContain("disabled: false");
  });

  it("ends with newline", () => {
    const result = cronFrontmatterSerialize({}, "body");

    expect(result.endsWith("\n")).toBe(true);
  });
});
