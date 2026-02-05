import type { AssistantMessage, Context } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";

import { tokensResolve } from "./tokensResolve.js";

describe("tokensResolve", () => {
  it("uses usage values when available", () => {
    const context: Context = {
      systemPrompt: "System",
      messages: [
        {
          role: "user",
          content: "Hello",
          timestamp: Date.now()
        }
      ]
    };
    const message: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "OK" }],
      api: "test",
      provider: "test",
      model: "test",
      usage: {
        input: 12,
        output: 3,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: "stop",
      timestamp: Date.now()
    };

    expect(tokensResolve(context, message)).toEqual({
      size: {
        input: 12,
        output: 3,
        cacheRead: 0,
        cacheWrite: 0,
        total: 15
      },
      source: "usage"
    });
  });

  it("estimates tokens when usage is missing", () => {
    const context: Context = {
      systemPrompt: "abcd",
      messages: [
        {
          role: "user",
          content: "hello",
          timestamp: Date.now()
        }
      ]
    };
    const message: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      api: "test",
      provider: "test",
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: "stop",
      timestamp: Date.now()
    };

    expect(tokensResolve(context, message)).toEqual({
      size: {
        input: 3,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        total: 4
      },
      source: "estimate"
    });
  });
});
