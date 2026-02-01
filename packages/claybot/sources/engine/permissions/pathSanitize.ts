import path from "node:path";

const MAX_PATH_LENGTH = 4096;

/**
 * Validates a path for dangerous characters and patterns.
 * Throws an error if the path is invalid.
 *
 * Checks for:
 * - Null bytes (can truncate strings in C libraries)
 * - Control characters (ASCII 0-31 except tab/newline)
 * - Excessively long paths (DoS potential)
 */
export function pathSanitize(target: string): void {
  if (target.length > MAX_PATH_LENGTH) {
    throw new Error(`Path exceeds maximum length of ${MAX_PATH_LENGTH} characters.`);
  }

  // Check for null bytes
  if (target.includes("\x00")) {
    throw new Error("Path contains null byte.");
  }

  // Check for control characters (ASCII 0-31, except 9=tab and 10=newline)
  for (let i = 0; i < target.length; i++) {
    const code = target.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10) {
      throw new Error("Path contains invalid control character.");
    }
  }
}

/**
 * Sanitizes and resolves a path, ensuring it's absolute.
 * Returns the resolved absolute path.
 */
export function pathSanitizeAndResolve(target: string): string {
  pathSanitize(target);
  if (!path.isAbsolute(target)) {
    throw new Error("Path must be absolute.");
  }
  return path.resolve(target);
}
