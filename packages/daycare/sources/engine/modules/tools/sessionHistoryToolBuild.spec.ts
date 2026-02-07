import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createId } from "@paralleldrive/cuid2";
import type { AssistantMessage, Context } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";

import type { ToolExecutionContext } from "@/types";
import { configResolve } from "../../../config/configResolve.js";
import { agentDescriptorWrite } from "../../agents/ops/agentDescriptorWrite.js";
import { agentHistoryAppend } from "../../agents/ops/agentHistoryAppend.js";
import { sessionHistoryToolBuild } from "./sessionHistoryToolBuild.js";

const toolCall = { id: "tool-1", name: "read_session_history" };

describe("sessionHistoryToolBuild", () => {
  it("returns summary output by default", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "daycare-session-history-tool-"));
    try {
      const config = configResolve(
        {
          engine: { dataDir: dir },
          assistant: { workspaceDir: dir },
          providers: [{ id: "openai", model: "gpt-4o-mini", enabled: true }]
        },
        path.join(dir, "settings.json")
      );
      const currentAgentId = createId();
      const targetAgentId = createId();
      await agentDescriptorWrite(config, targetAgentId, {
        type: "subagent",
        id: targetAgentId,
        parentAgentId: currentAgentId,
        name: "worker"
      });
      await agentHistoryAppend(config, targetAgentId, { type: "start", at: 10 });
      await agentHistoryAppend(config, targetAgentId, {
        type: "user_message",
        at: 20,
        text: "check logs",
        files: []
      });

      const tool = sessionHistoryToolBuild();
      const completeMock = vi.fn(async (..._args: unknown[]) => ({
        message: summaryAssistantMessageBuild("Summary:\n- reviewed history"),
        providerId: "openai",
        modelId: "gpt-test"
      }));
      const context = buildContext(currentAgentId, config, completeMock);
      const result = await tool.execute({ agentId: targetAgentId }, context, toolCall);

      const text = contentText(result.toolMessage.content);
      expect(result.toolMessage.isError).toBe(false);
      expect(text).toContain("Agent");
      expect(text).toContain("Summary:");
      expect(text).toContain("reviewed history");
      expect(completeMock).toHaveBeenCalledTimes(1);
      const summaryContext = completeMock.mock.calls[0]?.[0] as Context | undefined;
      expect(summaryContext).toBeDefined();
      expect(summaryContext?.messages).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns raw history when summarized is false", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "daycare-session-history-tool-"));
    try {
      const config = configResolve(
        {
          engine: { dataDir: dir },
          assistant: { workspaceDir: dir },
          providers: [{ id: "openai", model: "gpt-4o-mini", enabled: true }]
        },
        path.join(dir, "settings.json")
      );
      const currentAgentId = createId();
      const targetAgentId = createId();
      await agentDescriptorWrite(config, targetAgentId, {
        type: "subagent",
        id: targetAgentId,
        parentAgentId: currentAgentId,
        name: "worker"
      });
      await agentHistoryAppend(config, targetAgentId, { type: "start", at: 10 });
      await agentHistoryAppend(config, targetAgentId, {
        type: "note",
        at: 30,
        text: "done"
      });

      const tool = sessionHistoryToolBuild();
      const completeMock = vi.fn(async (..._args: unknown[]) => ({
        message: summaryAssistantMessageBuild("unused"),
        providerId: "openai",
        modelId: "gpt-test"
      }));
      const context = buildContext(currentAgentId, config, completeMock);
      const result = await tool.execute(
        { agentId: targetAgentId, summarized: false },
        context,
        toolCall
      );

      const text = contentText(result.toolMessage.content);
      expect(result.toolMessage.isError).toBe(false);
      expect(text).toContain("full session history");
      expect(text).toContain("\"type\": \"note\"");
      expect(completeMock).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function buildContext(
  agentId: string,
  config: ReturnType<typeof configResolve>,
  completeMock: (context: Context) => Promise<{
    message: AssistantMessage;
    providerId: string;
    modelId: string;
  }>
): ToolExecutionContext {
  return {
    connectorRegistry: null as unknown as ToolExecutionContext["connectorRegistry"],
    fileStore: null as unknown as ToolExecutionContext["fileStore"],
    auth: null as unknown as ToolExecutionContext["auth"],
    logger: console as unknown as ToolExecutionContext["logger"],
    assistant: null,
    permissions: config.defaultPermissions,
    agent: { id: agentId } as unknown as ToolExecutionContext["agent"],
    source: "test",
    messageContext: {},
    agentSystem: {
      config: { current: config },
      inferenceRouter: {
        complete: completeMock
      }
    } as unknown as ToolExecutionContext["agentSystem"],
    heartbeats: null as unknown as ToolExecutionContext["heartbeats"]
  };
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((item) => {
      if (typeof item !== "object" || item === null) {
        return false;
      }
      return (item as { type?: unknown }).type === "text";
    })
    .map((item) => (item as { text?: unknown }).text)
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function summaryAssistantMessageBuild(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "complete",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0
    }
  } as unknown as AssistantMessage;
}
