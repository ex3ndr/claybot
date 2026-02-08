import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { buildExecTool, buildWorkspaceReadTool } from "./tool.js";
import { Agent } from "../../engine/agents/agent.js";
import { AgentInbox } from "../../engine/agents/ops/agentInbox.js";
import { agentDescriptorBuild } from "../../engine/agents/ops/agentDescriptorBuild.js";
import type { AgentState, ToolExecutionContext } from "@/types";
import { createId } from "@paralleldrive/cuid2";

const execToolCall = { id: "tool-call-1", name: "exec" };
const readToolCall = { id: "tool-call-2", name: "read" };

describe("read tool allowed paths", () => {
  let workingDir: string;
  let outsideDir: string;
  let outsideFile: string;

  beforeEach(async () => {
    workingDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-tool-workspace-"));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-tool-outside-"));
    outsideFile = path.join(outsideDir, "outside.txt");
    await fs.writeFile(outsideFile, "outside-content", "utf8");
  });

  afterEach(async () => {
    await fs.rm(workingDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it("allows reading any absolute path when readDirs is empty", async () => {
    const tool = buildWorkspaceReadTool();
    const context = createContext(workingDir, false);

    const result = await tool.execute({ path: outsideFile }, context, readToolCall);
    const text = result.toolMessage.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    expect(result.toolMessage.isError).toBe(false);
    expect(text).toContain("outside-content");
  });

  it("keeps readDirs restrictions when explicitly configured", async () => {
    const tool = buildWorkspaceReadTool();
    const context = createContext(workingDir, false, [workingDir]);

    await expect(
      tool.execute({ path: outsideFile }, context, readToolCall)
    ).rejects.toThrow("Path is outside the allowed directories.");
  });

  it("allows reading write-granted files when readDirs are restricted", async () => {
    const tool = buildWorkspaceReadTool();
    const context = createContext(workingDir, false, [workingDir], [outsideFile]);

    const result = await tool.execute({ path: outsideFile }, context, readToolCall);
    const text = result.toolMessage.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    expect(result.toolMessage.isError).toBe(false);
    expect(text).toContain("outside-content");
  });
});

describe("exec tool allowedDomains", () => {
  let workingDir: string;

  beforeEach(async () => {
    workingDir = await fs.mkdtemp(path.join(os.tmpdir(), "exec-tool-test-"));
  });

  afterEach(async () => {
    await fs.rm(workingDir, { recursive: true, force: true });
  });

  it("throws when allowedDomains provided without network permission", async () => {
    const tool = buildExecTool();
    const context = createContext(workingDir, false);

    await expect(
      tool.execute(
        { command: "echo ok", allowedDomains: ["example.com"] },
        context,
        execToolCall
      )
    ).rejects.toThrow("Network permission is required");
  });

  it("throws when packageManagers provided without network permission", async () => {
    const tool = buildExecTool();
    const context = createContext(workingDir, false);

    await expect(
      tool.execute(
        { command: "echo ok", packageManagers: ["node"] },
        context,
        execToolCall
      )
    ).rejects.toThrow("Network permission is required");
  });

  it("throws when allowedDomains includes '*'", async () => {
    const tool = buildExecTool();
    const context = createContext(workingDir, true);

    await expect(
      tool.execute(
        { command: "echo ok", allowedDomains: ["*"] },
        context,
        execToolCall
      )
    ).rejects.toThrow("Wildcard");
  });

  it("uses zero permissions by default when none are provided", async () => {
    const tool = buildExecTool();
    const context = createContext(workingDir, true);

    await expect(
      tool.execute(
        { command: "echo ok", allowedDomains: ["example.com"] },
        context,
        execToolCall
      )
    ).rejects.toThrow("Network permission is required");
  });

  it("only allows exact domain unless wildcard subdomain is listed", async () => {
    const tool = buildExecTool();
    const context = createContext(workingDir, true);

    const allowedResult = await tool.execute(
      {
        command: "curl -I -sS https://google.com",
        allowedDomains: ["google.com"],
        permissions: ["@network"],
        timeoutMs: 30_000
      },
      context,
      execToolCall
    );
    const allowedText = allowedResult.toolMessage.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    expect(allowedResult.toolMessage.isError).toBe(false);
    expect(allowedText).toContain("HTTP/");

    const blockedResult = await tool.execute(
      {
        command: "curl -I -sS https://www.google.com",
        allowedDomains: ["google.com"],
        permissions: ["@network"],
        timeoutMs: 30_000
      },
      context,
      execToolCall
    );
    const blockedText = blockedResult.toolMessage.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    expect(blockedResult.toolMessage.isError).toBe(true);
    expect(blockedText).toContain("CONNECT tunnel failed");
  });

  it("maps HOME to provided home path", async () => {
    const tool = buildExecTool();
    const context = createContext(workingDir, false, [], [workingDir]);
    const home = path.join(workingDir, ".daycare-home");

    const result = await tool.execute(
      {
        command: "printf '%s' \"$HOME\"",
        home,
        permissions: [`@write:${workingDir}`]
      },
      context,
      execToolCall
    );
    const text = result.toolMessage.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    const expectedHome = await fs.realpath(home);
    expect(result.toolMessage.isError).toBe(false);
    expect(text).toContain(`stdout:\n${expectedHome}`);
  });

  it("rejects HOME path when not write-granted", async () => {
    const tool = buildExecTool();
    const context = createContext(workingDir, false);
    const home = path.join(workingDir, ".daycare-home");

    await expect(
      tool.execute(
        {
          command: "echo ok",
          home
        },
        context,
        execToolCall
      )
    ).rejects.toThrow("Path is outside the allowed directories.");
  });
});

function createContext(
  workingDir: string,
  network: boolean,
  readDirs: string[] = [],
  writeDirs: string[] = []
): ToolExecutionContext {
  const agentId = createId();
  const messageContext = {};
  const descriptor = agentDescriptorBuild("system", messageContext, agentId);
  const now = Date.now();
  const state: AgentState = {
    context: { messages: [] },
    permissions: {
      workingDir,
      writeDirs: writeDirs.map((entry) => path.resolve(entry)),
      readDirs: readDirs.map((entry) => path.resolve(entry)),
      network
    },
    tokens: null,
    stats: {},
    createdAt: now,
    updatedAt: now,
    state: "active"
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
