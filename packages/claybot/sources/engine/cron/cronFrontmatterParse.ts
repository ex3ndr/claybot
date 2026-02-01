import type { Frontmatter, ParsedDocument } from "./cronTypes.js";

/**
 * Parses YAML frontmatter from markdown content.
 * Supports simple key: value pairs only.
 *
 * Expects: markdown content string, optionally with --- delimited frontmatter.
 * Returns: parsed frontmatter object and remaining body text.
 */
export function cronFrontmatterParse(content: string): ParsedDocument {
  const trimmed = content.trim();

  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: trimmed };
  }

  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: trimmed };
  }

  const frontmatterBlock = trimmed.slice(4, endIndex);
  const body = trimmed.slice(endIndex + 4).trim();

  const frontmatter: Frontmatter = {};
  const lines = frontmatterBlock.split("\n");

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const colonIndex = trimmedLine.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, colonIndex).trim();
    let value: string | number | boolean = trimmedLine.slice(colonIndex + 1).trim();

    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    } else if (!isNaN(Number(value)) && value.length > 0) {
      value = Number(value);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}
