import { describe, expect, it } from "vitest";

import type { ToolCall } from "@mariozechner/pi-ai";
import type { AgentHistoryRecord, ToolExecutionResult } from "@/types";
import { contextEstimateTokens } from "./contextEstimateTokens.js";

describe("contextEstimateTokens", () => {
  it("estimates tokens from user, assistant, and tool records", () => {
    const userText = "abcd";
    const assistantText = "hello!";
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "tool-1",
      name: "exec",
      arguments: { cmd: "ls" }
    };
    const toolOutputText = "tool-output";
    const toolResult: ToolExecutionResult = {
      toolMessage: {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "exec",
        content: [{ type: "text", text: toolOutputText }],
        isError: false,
        timestamp: Date.now()
      },
      files: []
    };

    const history: AgentHistoryRecord[] = [
      { type: "user_message", at: 1, text: userText, files: [] },
      {
        type: "assistant_message",
        at: 2,
        text: assistantText,
        files: [],
        toolCalls: [toolCall],
        tokens: {
          provider: "test",
          model: "test-model",
          size: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            total: 2
          }
        }
      },
      { type: "tool_result", at: 3, toolCallId: "tool-1", output: toolResult }
    ];

    const symbols =
      userText.length +
      assistantText.length +
      JSON.stringify(toolCall).length +
      toolOutputText.length;
    const expected = Math.ceil(symbols / 4);

    expect(contextEstimateTokens(history)).toBe(expected);
  });

  it("does not scale image estimates with inline data size", () => {
    const smallImage = "x".repeat(8);
    const largeImage = "x".repeat(8000);
    const smallResult: ToolExecutionResult = {
      toolMessage: {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "image_generation",
        content: [{ type: "image", data: smallImage, mimeType: "image/png" }],
        isError: false,
        timestamp: Date.now()
      },
      files: []
    };
    const largeResult: ToolExecutionResult = {
      toolMessage: {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "image_generation",
        content: [{ type: "image", data: largeImage, mimeType: "image/png" }],
        isError: false,
        timestamp: Date.now()
      },
      files: []
    };
    const smallHistory: AgentHistoryRecord[] = [
      { type: "tool_result", at: 1, toolCallId: "tool-1", output: smallResult }
    ];
    const largeHistory: AgentHistoryRecord[] = [
      { type: "tool_result", at: 1, toolCallId: "tool-1", output: largeResult }
    ];

    expect(contextEstimateTokens(largeHistory)).toBe(contextEstimateTokens(smallHistory));
  });
});
