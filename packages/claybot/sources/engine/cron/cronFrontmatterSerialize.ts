import type { Frontmatter } from "./cronTypes.js";

/**
 * Serializes frontmatter and body to markdown format.
 *
 * Expects: frontmatter object and body string.
 * Returns: markdown string with --- delimited frontmatter.
 */
export function cronFrontmatterSerialize(frontmatter: Frontmatter, body: string): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value === "string") {
      // Quote strings that contain special characters
      if (value.includes(":") || value.includes("\n") || value.includes('"')) {
        lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(body);
  lines.push("");

  return lines.join("\n");
}
