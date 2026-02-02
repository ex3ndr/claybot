import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { buildExecTool } from "./tool.js";
import { Agent } from "../../engine/agents/agent.js";
import { AgentInbox } from "../../engine/agents/ops/agentInbox.js";
import { agentDescriptorBuild } from "../../engine/agents/ops/agentDescriptorBuild.js";
import type { AgentState, ToolExecutionContext } from "@/types";
import { createId } from "@paralleldrive/cuid2";

const toolCall = { id: "tool-call-1", name: "exec" };

describe("exec tool allowedDomains", () => {
  let workingDir: string;

  beforeEach(async () => {
    workingDir = await fs.mkdtemp(path.join(os.tmpdir(), "exec-tool-test-"));
  });

  afterEach(async () => {
    await fs.rm(workingDir, { recursive: true, force: true });
  });

  it("throws when allowedDomains provided without web permission", async () => {
    const tool = buildExecTool();
    const context = createContext(workingDir, false);

    await expect(
      tool.execute(
        { command: "echo ok", allowedDomains: ["example.com"] },
        context,
        toolCall
      )
    ).rejects.toThrow("Web permission is required");
  });

  it("throws when allowedDomains includes '*'", async () => {
    const tool = buildExecTool();
    const context = createContext(workingDir, true);

    await expect(
      tool.execute(
        { command: "echo ok", allowedDomains: ["*"] },
        context,
        toolCall
      )
    ).rejects.toThrow("Wildcard");
  });
});

function createContext(workingDir: string, web: boolean): ToolExecutionContext {
  const agentId = createId();
  const messageContext = {};
  const descriptor = agentDescriptorBuild("system", messageContext, agentId);
  const now = Date.now();
  const state: AgentState = {
    context: { messages: [] },
    permissions: {
      workingDir,
      writeDirs: [],
      readDirs: [],
      web
    },
    createdAt: now,
    updatedAt: now,
    sleeping: false
  };
  const agent = Agent.restore(
    agentId,
    descriptor,
    state,
    new AgentInbox(agentId),
    {} as unknown as Parameters<typeof Agent.restore>[4]
  );
  return {
    connectorRegistry: null as unknown as ToolExecutionContext["connectorRegistry"],
    fileStore: null as unknown as ToolExecutionContext["fileStore"],
    auth: null as unknown as ToolExecutionContext["auth"],
    logger: console as unknown as ToolExecutionContext["logger"],
    assistant: null,
    permissions: state.permissions,
    agent,
    source: "test",
    messageContext,
    agentSystem: null as unknown as ToolExecutionContext["agentSystem"],
    heartbeats: null as unknown as ToolExecutionContext["heartbeats"]
  };
}
