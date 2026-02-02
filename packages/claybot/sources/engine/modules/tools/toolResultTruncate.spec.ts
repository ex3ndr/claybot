import { describe, expect, it } from "vitest";

import type { ToolExecutionResult } from "@/types";
import { toolResultTruncate } from "./toolResultTruncate.js";

describe("toolResultTruncate", () => {
  it("appends truncation notice for long text blocks", () => {
    const longText = "a".repeat(5000);
    const result: ToolExecutionResult = {
      toolMessage: {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "exec",
        content: [{ type: "text", text: longText }],
        isError: false,
        timestamp: Date.now()
      },
      files: []
    };

    const truncated = toolResultTruncate(result);
    const content = truncated.toolMessage.content as Array<{ type: "text"; text: string }>;
    const text = content[0]?.text ?? "";
    expect(text).not.toBe(longText);
    expect(text.endsWith("Command output was truncated")).toBe(true);
  });

  it("returns original result for short text", () => {
    const result: ToolExecutionResult = {
      toolMessage: {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "exec",
        content: [{ type: "text", text: "ok" }],
        isError: false,
        timestamp: Date.now()
      },
      files: []
    };

    const truncated = toolResultTruncate(result);
    expect(truncated).toBe(result);
  });
});
