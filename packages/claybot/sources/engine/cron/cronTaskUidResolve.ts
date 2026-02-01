import type { Frontmatter } from "./cronTypes.js";

/**
 * Extracts the taskId (UID) from frontmatter.
 *
 * Expects: frontmatter object that may contain a taskId field.
 * Returns: the trimmed taskId string or null if not present/valid.
 */
export function cronTaskUidResolve(frontmatter: Frontmatter): string | null {
  const candidate = frontmatter.taskId;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return null;
}
