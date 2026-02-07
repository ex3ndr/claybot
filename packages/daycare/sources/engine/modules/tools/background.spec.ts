import { describe, expect, it, vi } from "vitest";

import type { SessionPermissions, ToolExecutionContext } from "@/types";
import { buildStartBackgroundAgentTool } from "./background.js";

const toolCall = { id: "tool-1", name: "start_background_agent" };

describe("buildStartBackgroundAgentTool", () => {
  it("grants validated permissions before posting the first message", async () => {
    const calls: string[] = [];
    const resolveTarget = vi.fn(async () => {
      calls.push("resolve");
      return "agent-123";
    });
    const grantPermission = vi.fn(async () => {
      calls.push("grant");
    });
    const post = vi.fn(async () => {
      calls.push("post");
    });

    const tool = buildStartBackgroundAgentTool();
    const context = contextBuild(
      buildPermissions({ network: true, readDirs: ["/tmp"] }),
      {
        agentIdForTarget: resolveTarget,
        grantPermission,
        post
      }
    );

    const result = await tool.execute(
      {
        prompt: "Do work",
        permissions: ["@network", "@read:/tmp"]
      },
      context,
      toolCall
    );

    expect(calls).toEqual(["resolve", "grant", "grant", "post"]);
    expect(grantPermission).toHaveBeenNthCalledWith(
      1,
      { agentId: "agent-123" },
      { kind: "network" }
    );
    expect(grantPermission).toHaveBeenNthCalledWith(
      2,
      { agentId: "agent-123" },
      { kind: "read", path: "/tmp" }
    );
    expect(post).toHaveBeenCalledWith(
      { agentId: "agent-123" },
      { type: "message", message: { text: "Do work" }, context: {} }
    );
    expect(contentText(result.toolMessage.content)).toContain("agent-123");
  });

  it("rejects permissions the creator does not have", async () => {
    const resolveTarget = vi.fn(async () => "agent-123");
    const grantPermission = vi.fn(async () => undefined);
    const post = vi.fn(async () => undefined);

    const tool = buildStartBackgroundAgentTool();
    const context = contextBuild(
      buildPermissions({ network: false }),
      {
        agentIdForTarget: resolveTarget,
        grantPermission,
        post
      }
    );

    await expect(
      tool.execute(
        { prompt: "Do work", permissions: ["@network"] },
        context,
        toolCall
      )
    ).rejects.toThrow("Cannot attach permission");

    expect(resolveTarget).not.toHaveBeenCalled();
    expect(grantPermission).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});

function buildPermissions(
  overrides: Partial<SessionPermissions>
): SessionPermissions {
  return {
    workingDir: "/workspace",
    writeDirs: ["/workspace"],
    readDirs: [],
    network: false,
    ...overrides
  };
}

function contextBuild(
  permissions: SessionPermissions,
  agentSystem: {
    agentIdForTarget: (target: unknown) => Promise<string>;
    grantPermission: (target: unknown, access: unknown) => Promise<void>;
    post: (target: unknown, item: unknown) => Promise<void>;
  }
): ToolExecutionContext {
  return {
    connectorRegistry: null as unknown as ToolExecutionContext["connectorRegistry"],
    fileStore: null as unknown as ToolExecutionContext["fileStore"],
    auth: null as unknown as ToolExecutionContext["auth"],
    logger: console as unknown as ToolExecutionContext["logger"],
    assistant: null,
    permissions,
    agent: { id: "parent-agent" } as unknown as ToolExecutionContext["agent"],
    source: "test",
    messageContext: {},
    agentSystem: agentSystem as unknown as ToolExecutionContext["agentSystem"],
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
