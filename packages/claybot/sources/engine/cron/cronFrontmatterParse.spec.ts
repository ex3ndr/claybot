import { describe, it, expect } from "vitest";

import { cronFrontmatterParse } from "./cronFrontmatterParse.js";

describe("cronFrontmatterParse", () => {
  it("parses basic frontmatter", () => {
    const content = `---
name: Daily Report
schedule: 0 9 * * *
enabled: true
---

Generate a daily report.`;

    const result = cronFrontmatterParse(content);

    expect(result.frontmatter).toEqual({
      name: "Daily Report",
      schedule: "0 9 * * *",
      enabled: true
    });
    expect(result.body).toBe("Generate a daily report.");
  });

  it("handles content without frontmatter", () => {
    const content = "Just some text";

    const result = cronFrontmatterParse(content);

    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("Just some text");
  });

  it("handles quoted values", () => {
    const content = `---
name: "Task: Important"
---

Body`;

    const result = cronFrontmatterParse(content);

    expect(result.frontmatter.name).toBe("Task: Important");
  });

  it("handles single-quoted values", () => {
    const content = `---
name: 'Task: Important'
---

Body`;

    const result = cronFrontmatterParse(content);

    expect(result.frontmatter.name).toBe("Task: Important");
  });

  it("parses numeric values", () => {
    const content = `---
count: 42
---

Body`;

    const result = cronFrontmatterParse(content);

    expect(result.frontmatter.count).toBe(42);
  });

  it("parses boolean false", () => {
    const content = `---
enabled: false
---

Body`;

    const result = cronFrontmatterParse(content);

    expect(result.frontmatter.enabled).toBe(false);
  });

  it("skips comment lines", () => {
    const content = `---
# This is a comment
name: Test
---

Body`;

    const result = cronFrontmatterParse(content);

    expect(result.frontmatter).toEqual({ name: "Test" });
  });

  it("handles missing closing delimiter", () => {
    const content = `---
name: Test

Body without closing`;

    const result = cronFrontmatterParse(content);

    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(content);
  });
});
