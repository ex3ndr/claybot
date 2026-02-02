import { describe, expect, it } from "vitest";

import { toolResultFormatVerbose } from "./toolResultFormatVerbose.js";
import type { ToolExecutionResult } from "@/types";

const baseToolMessage = {
  role: "toolResult" as const,
  toolCallId: "tool-1",
  toolName: "do_thing",
  content: [{ type: "text" as const, text: "ok" }],
  isError: false,
  timestamp: Date.now()
};

describe("toolResultFormatVerbose", () => {
  it("formats success results with file counts", () => {
    const result: ToolExecutionResult = {
      toolMessage: baseToolMessage,
      files: [{ id: "file-1", name: "file.txt", mimeType: "text/plain", size: 10, path: "/tmp/file.txt" }]
    };

    const text = toolResultFormatVerbose(result);
    expect(text).toContain("[result]");
    expect(text).toContain("1 file");
  });

  it("formats error results", () => {
    const result: ToolExecutionResult = {
      toolMessage: { ...baseToolMessage, isError: true },
      files: []
    };

    const text = toolResultFormatVerbose(result);
    expect(text).toContain("[error]");
  });
});
