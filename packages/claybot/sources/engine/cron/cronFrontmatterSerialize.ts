import matter from "gray-matter";

import type { Frontmatter } from "./cronTypes.js";

/**
 * Serializes frontmatter and body to markdown format using gray-matter.
 *
 * Expects: frontmatter object and body string.
 * Returns: markdown string with --- delimited frontmatter.
 */
export function cronFrontmatterSerialize(frontmatter: Frontmatter, body: string): string {
  return matter.stringify(body, frontmatter);
}
