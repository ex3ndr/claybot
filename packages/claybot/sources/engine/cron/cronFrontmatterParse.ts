import matter from "gray-matter";

import type { Frontmatter, ParsedDocument } from "./cronTypes.js";

/**
 * Parses YAML frontmatter from markdown content using gray-matter.
 *
 * Expects: markdown content string, optionally with --- delimited frontmatter.
 * Returns: parsed frontmatter object and remaining body text.
 */
export function cronFrontmatterParse(content: string): ParsedDocument {
  try {
    const result = matter(content);
    return {
      frontmatter: result.data as Frontmatter,
      body: result.content.trim()
    };
  } catch {
    // On parse error, return empty frontmatter and original content
    return {
      frontmatter: {},
      body: content.trim()
    };
  }
}
