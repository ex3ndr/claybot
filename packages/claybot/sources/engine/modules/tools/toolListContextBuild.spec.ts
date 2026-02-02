import { describe, expect, it } from "vitest";

import type { Connector } from "@/types";
import { toolListContextBuild } from "./toolListContextBuild.js";

import type { Tool } from "@mariozechner/pi-ai";

const baseTools = [
  { name: "cron_read_memory", description: "", parameters: {} },
  { name: "cron_write_memory", description: "", parameters: {} },
  { name: "send_file", description: "", parameters: {} },
  { name: "set_reaction", description: "", parameters: {} },
  { name: "generate_image", description: "", parameters: {} },
  { name: "other", description: "", parameters: {} }
] as unknown as Tool[];

describe("toolListContextBuild", () => {
  it("filters cron tools for non-cron sources", () => {
    const result = toolListContextBuild({
      tools: baseTools,
      source: "slack",
      connectorRegistry: {
        get: () => null,
        list: () => []
      },
      imageRegistry: { list: () => [] }
    });

    const names = result.map((tool) => tool.name);
    expect(names).not.toContain("cron_read_memory");
    expect(names).not.toContain("cron_write_memory");
  });

  it("removes background denylist tools", () => {
    const connector: Connector = {
      capabilities: { sendText: true, reactions: true, sendFiles: { modes: ["photo"] } },
      onMessage: () => () => undefined,
      sendMessage: async () => undefined
    };
    const result = toolListContextBuild({
      tools: baseTools,
      source: "slack",
      agentKind: "background",
      connectorRegistry: {
        get: () => connector,
        list: () => ["slack"]
      },
      imageRegistry: { list: () => [] }
    });

    const names = result.map((tool) => tool.name);
    expect(names).not.toContain("send_file");
    expect(names).not.toContain("set_reaction");
  });

  it("hides file and reaction tools when unsupported", () => {
    const connector: Connector = {
      capabilities: { sendText: true },
      onMessage: () => () => undefined,
      sendMessage: async () => undefined
    };
    const result = toolListContextBuild({
      tools: baseTools,
      source: "slack",
      connectorRegistry: {
        get: () => connector,
        list: () => ["slack"]
      },
      imageRegistry: { list: () => [] }
    });

    const names = result.map((tool) => tool.name);
    expect(names).not.toContain("send_file");
    expect(names).not.toContain("set_reaction");
  });

  it("removes image tools when no providers", () => {
    const result = toolListContextBuild({
      tools: baseTools,
      connectorRegistry: {
        get: () => null,
        list: () => []
      },
      imageRegistry: { list: () => [] }
    });

    const names = result.map((tool) => tool.name);
    expect(names).not.toContain("generate_image");
  });
});
