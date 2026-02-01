import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { buildExecTool } from "./tool.js";
import type { ToolExecutionContext } from "../../engine/tools/types.js";

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
  return {
    connectorRegistry: null,
    fileStore: null as unknown as ToolExecutionContext["fileStore"],
    auth: null as unknown as ToolExecutionContext["auth"],
    logger: console as unknown as ToolExecutionContext["logger"],
    assistant: null,
    permissions: {
      workingDir,
      writeDirs: [],
      readDirs: [],
      web
    },
    session: { context: { state: {} } } as ToolExecutionContext["session"],
    source: "test",
    messageContext: {
      channelId: "test",
      userId: "test-user"
    }
  };
}
