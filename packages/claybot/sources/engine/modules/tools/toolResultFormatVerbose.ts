import { stringTruncate } from "../../../utils/stringTruncate.js";
import type { ToolExecutionResult } from "@/types";

/**
 * Formats tool execution results for verbose logging output.
 * Expects: result.toolMessage is a ToolResultMessage from the tool execution.
 */
export function toolResultFormatVerbose(result: ToolExecutionResult): string {
  if (result.toolMessage.isError) {
    const errorContent = result.toolMessage.content;
    const errorText = typeof errorContent === "string"
      ? stringTruncate(errorContent, 200)
      : stringTruncate(JSON.stringify(errorContent), 200);
    return `[error] ${errorText}`;
  }
  const content = result.toolMessage.content;
  const contentText = typeof content === "string"
    ? content
    : JSON.stringify(content);
  const truncated = stringTruncate(contentText, 300);
  const fileInfo = result.files.length
    ? ` (${result.files.length} file${result.files.length > 1 ? "s" : ""})`
    : "";
  return `[result]${fileInfo} ${truncated}`;
}
