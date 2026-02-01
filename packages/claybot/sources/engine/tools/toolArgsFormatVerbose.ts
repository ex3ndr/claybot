import { stringTruncate } from "../../utils/stringTruncate.js";

/**
 * Formats tool arguments for verbose logging output.
 * Expects: args is a plain object of tool arguments.
 */
export function toolArgsFormatVerbose(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) {
    return "";
  }
  const formatted = entries.map(([key, value]) => {
    const valueStr = typeof value === "string"
      ? stringTruncate(value, 100)
      : JSON.stringify(value);
    return `${key}=${valueStr}`;
  });
  return formatted.join(", ");
}
