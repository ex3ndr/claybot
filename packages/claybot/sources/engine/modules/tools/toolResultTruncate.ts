import type { ToolExecutionResult } from "@/types";

const MAX_TOOL_RESULT_CHARS = 4000;
const TRUNCATION_NOTICE = "\n\nCommand output was truncated";

/**
 * Truncates long tool result text payloads and appends a notice.
 * Expects: content is a single text block or a string.
 */
export function toolResultTruncate(result: ToolExecutionResult): ToolExecutionResult {
  const content = result.toolMessage.content;
  if (typeof content === "string") {
    const next = truncateText(content);
    return {
      ...result,
      toolMessage: {
        ...result.toolMessage,
        content: [{ type: "text", text: next }]
      }
    };
  }
  if (Array.isArray(content) && content.length === 1 && content[0]?.type === "text") {
    const text = content[0].text;
    const next = truncateText(text);
    if (next === text) {
      return result;
    }
    return {
      ...result,
      toolMessage: {
        ...result.toolMessage,
        content: [{ type: "text", text: next }]
      }
    };
  }
  return result;
}

function truncateText(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) {
    return text;
  }
  const maxBody = Math.max(0, MAX_TOOL_RESULT_CHARS - TRUNCATION_NOTICE.length);
  return text.slice(0, maxBody).trimEnd() + TRUNCATION_NOTICE;
}
