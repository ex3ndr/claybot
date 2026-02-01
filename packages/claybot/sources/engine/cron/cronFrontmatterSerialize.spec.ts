import { describe, it, expect } from "vitest";

import { cronFrontmatterParse } from "./cronFrontmatterParse.js";
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
    expect(result).toContain("name:");
    expect(result).toContain("Do something.");
  });

  it("round-trips strings with colons", () => {
    const frontmatter = { name: "Task: Important" };
    const serialized = cronFrontmatterSerialize(frontmatter, "body");
    const parsed = cronFrontmatterParse(serialized);

    expect(parsed.frontmatter.name).toBe("Task: Important");
    expect(parsed.body).toBe("body");
  });

  it("round-trips strings with newlines", () => {
    const frontmatter = { desc: "line1\nline2" };
    const serialized = cronFrontmatterSerialize(frontmatter, "body");
    const parsed = cronFrontmatterParse(serialized);

    expect(parsed.frontmatter.desc).toBe("line1\nline2");
  });

  it("round-trips strings with quotes", () => {
    const frontmatter = { name: 'Say "hello"' };
    const serialized = cronFrontmatterSerialize(frontmatter, "body");
    const parsed = cronFrontmatterParse(serialized);

    expect(parsed.frontmatter.name).toBe('Say "hello"');
  });

  it("serializes numeric values", () => {
    const frontmatter = { count: 42 };
    const serialized = cronFrontmatterSerialize(frontmatter, "body");
    const parsed = cronFrontmatterParse(serialized);

    expect(parsed.frontmatter.count).toBe(42);
  });

  it("serializes boolean values", () => {
    const frontmatter = { enabled: true, disabled: false };
    const serialized = cronFrontmatterSerialize(frontmatter, "body");
    const parsed = cronFrontmatterParse(serialized);

    expect(parsed.frontmatter.enabled).toBe(true);
    expect(parsed.frontmatter.disabled).toBe(false);
  });

  it("ends with newline", () => {
    const result = cronFrontmatterSerialize({}, "body");

    expect(result.endsWith("\n")).toBe(true);
  });
});
