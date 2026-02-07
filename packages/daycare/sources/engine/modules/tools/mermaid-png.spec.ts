import { describe, expect, it, vi } from "vitest";

import type { ToolExecutionContext } from "@/types";
import { buildMermaidPngTool } from "./mermaid-png.js";

const mocks = vi.hoisted(() => ({
  renderToPng: vi.fn(async () => Buffer.from("png"))
}));

vi.mock("../../../util/renderToPng.js", () => ({
  renderToPng: mocks.renderToPng
}));

describe("buildMermaidPngTool", () => {
  it("renders a png file from mermaid source", async () => {
    const saveBuffer = vi.fn(async (options: {
      name: string;
      mimeType: string;
      data: Buffer;
      source: string;
    }) => ({
      id: "file-1",
      name: options.name,
      path: "/tmp/file-1.png",
      mimeType: options.mimeType,
      size: options.data.byteLength,
      source: options.source,
      createdAt: "2026-01-01T00:00:00.000Z"
    }));

    const tool = buildMermaidPngTool();
    const result = await tool.execute(
      {
        mermaid: "graph LR\n  A --> B",
        name: "pipeline"
      },
      contextBuild(saveBuffer),
      { id: "call-1", name: "generate_mermaid_png" }
    );

    expect(saveBuffer).toHaveBeenCalledTimes(1);
    expect(mocks.renderToPng).toHaveBeenCalledTimes(1);
    expect(saveBuffer.mock.calls[0]?.[0]).toMatchObject({
      name: "pipeline.png",
      mimeType: "image/png",
      source: "generate_mermaid_png"
    });
    expect(result.files).toEqual([
      {
        id: "file-1",
        name: "pipeline.png",
        mimeType: "image/png",
        size: expect.any(Number),
        path: "/tmp/file-1.png"
      }
    ]);
    expect(result.toolMessage.isError).toBe(false);
  });

  it("rejects fenced markdown input", async () => {
    const saveBuffer = vi.fn();
    const tool = buildMermaidPngTool();

    await expect(
      tool.execute(
        {
          mermaid: "```mermaid\ngraph LR\n  A --> B\n```"
        },
        contextBuild(saveBuffer),
        { id: "call-1", name: "generate_mermaid_png" }
      )
    ).rejects.toThrow("raw Mermaid source without ``` fences");

    expect(saveBuffer).not.toHaveBeenCalled();
  });

  it("rejects unknown theme", async () => {
    const saveBuffer = vi.fn();
    const tool = buildMermaidPngTool();

    await expect(
      tool.execute(
        {
          mermaid: "graph LR\n  A --> B",
          theme: "not-a-theme"
        },
        contextBuild(saveBuffer),
        { id: "call-1", name: "generate_mermaid_png" }
      )
    ).rejects.toThrow("Unknown Mermaid theme");

    expect(saveBuffer).not.toHaveBeenCalled();
  });
});

function contextBuild(saveBuffer: (options: {
  name: string;
  mimeType: string;
  data: Buffer;
  source: string;
}) => Promise<{
  id: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  source: string;
  createdAt: string;
}>): ToolExecutionContext {
  return {
    connectorRegistry: null as unknown as ToolExecutionContext["connectorRegistry"],
    fileStore: { saveBuffer } as unknown as ToolExecutionContext["fileStore"],
    auth: null as unknown as ToolExecutionContext["auth"],
    logger: console as unknown as ToolExecutionContext["logger"],
    assistant: null,
    permissions: {
      workingDir: "/tmp",
      writeDirs: [],
      readDirs: [],
      network: false
    },
    agent: { id: "agent-test" } as unknown as ToolExecutionContext["agent"],
    source: "test",
    messageContext: {} as unknown as ToolExecutionContext["messageContext"],
    agentSystem: null as unknown as ToolExecutionContext["agentSystem"],
    heartbeats: null as unknown as ToolExecutionContext["heartbeats"]
  };
}
