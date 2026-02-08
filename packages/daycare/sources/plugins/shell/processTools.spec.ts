import { describe, expect, it, vi } from "vitest";

import type { ProcessCreateInput, ProcessInfo, Processes } from "../../engine/processes/processes.js";
import type { SessionPermissions, ToolExecutionContext } from "@/types";
import { buildProcessStartTool } from "./processTools.js";

describe("process_start permissions", () => {
  it("uses read-only scoped caller permissions when none are provided", async () => {
    let capturedPermissions: SessionPermissions | null = null;
    const create = vi.fn(async (_input: ProcessCreateInput, permissions: SessionPermissions) => {
      capturedPermissions = permissions;
      return buildProcessInfo();
    });
    const tool = buildProcessStartTool({ create } as unknown as Processes);

    await tool.execute(
      {
        command: "echo hello"
      },
      createContext({
        workingDir: "/workspace",
        writeDirs: ["/workspace", "/tmp"],
        readDirs: ["/workspace", "/tmp", "/tmp/read-only"],
        network: true
      }),
      { id: "call-0", name: "process_start" }
    );

    expect(capturedPermissions).toEqual({
      workingDir: "/workspace",
      writeDirs: [],
      readDirs: ["/workspace", "/tmp", "/tmp/read-only"],
      network: false
    });
  });

  it("does not mutate tool context permissions", async () => {
    const create = vi.fn(async () => buildProcessInfo());
    const tool = buildProcessStartTool({ create } as unknown as Processes);
    const permissions: SessionPermissions = {
      workingDir: "/workspace",
      writeDirs: ["/workspace", "/tmp"],
      readDirs: ["/workspace", "/tmp"],
      network: true
    };
    const original = {
      workingDir: permissions.workingDir,
      writeDirs: [...permissions.writeDirs],
      readDirs: [...permissions.readDirs],
      network: permissions.network
    };
    const context = createContext(permissions);

    await tool.execute(
      {
        command: "echo hello",
        permissions: ["@write:/tmp", "@network"]
      },
      context,
      { id: "call-0b", name: "process_start" }
    );

    expect(context.permissions).toEqual(original);
  });

  it("rejects requested permissions that are not held by the caller", async () => {
    const create = vi.fn(async () => buildProcessInfo());
    const tool = buildProcessStartTool({ create } as unknown as Processes);

    await expect(
      tool.execute(
        {
          command: "echo hello",
          permissions: ["@network"]
        },
        createContext({
          workingDir: "/workspace",
          writeDirs: ["/workspace"],
          readDirs: ["/workspace"],
          network: false
        }),
        { id: "call-1", name: "process_start" }
      )
    ).rejects.toThrow("Cannot attach permission '@network'");

    expect(create).not.toHaveBeenCalled();
  });

  it("adds requested permissions without dropping caller read scope", async () => {
    let capturedPermissions: SessionPermissions | null = null;
    const create = vi.fn(async (_input: ProcessCreateInput, permissions: SessionPermissions) => {
      capturedPermissions = permissions;
      return buildProcessInfo();
    });
    const tool = buildProcessStartTool({ create } as unknown as Processes);

    await tool.execute(
      {
        command: "echo hello",
        permissions: ["@write:/tmp"]
      },
      createContext({
        workingDir: "/workspace",
        writeDirs: ["/workspace", "/tmp"],
        readDirs: ["/workspace", "/tmp", "/tmp/read-only"],
        network: true
      }),
      { id: "call-2", name: "process_start" }
    );

    expect(capturedPermissions).toEqual({
      workingDir: "/workspace",
      writeDirs: ["/tmp"],
      readDirs: ["/workspace", "/tmp", "/tmp/read-only"],
      network: false
    });
  });
});

function createContext(permissions: SessionPermissions): ToolExecutionContext {
  return {
    connectorRegistry: null as unknown as ToolExecutionContext["connectorRegistry"],
    fileStore: null as unknown as ToolExecutionContext["fileStore"],
    auth: null as unknown as ToolExecutionContext["auth"],
    logger: null as unknown as ToolExecutionContext["logger"],
    assistant: null,
    permissions,
    agent: null as unknown as ToolExecutionContext["agent"],
    source: "test",
    messageContext: {},
    agentSystem: null as unknown as ToolExecutionContext["agentSystem"],
    heartbeats: null as unknown as ToolExecutionContext["heartbeats"]
  };
}

function buildProcessInfo(): ProcessInfo {
  const now = Date.now();
  return {
    id: "process-id",
    name: "process-name",
    command: "echo hello",
    cwd: "/workspace",
    home: null,
    pid: 100,
    keepAlive: false,
    desiredState: "running",
    status: "running",
    restartCount: 0,
    createdAt: now,
    updatedAt: now,
    lastStartedAt: now,
    lastExitedAt: null,
    logPath: "/tmp/process.log"
  };
}
