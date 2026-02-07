import { describe, expect, it } from "vitest";

import type { ToolExecutionContext } from "@/types";
import { EngineEventBus } from "../../ipc/events.js";
import { Signals } from "../../signals/signals.js";
import { buildSignalGenerateTool } from "./signal.js";

const toolCall = { id: "tool-1", name: "generate_signal" };

describe("buildSignalGenerateTool", () => {
  it("generates agent source signals by default", async () => {
    const eventBus = new EngineEventBus();
    const signals = new Signals({ eventBus });
    const events: Array<{ type: string; payload: unknown }> = [];

    const unsubscribe = eventBus.onEvent((event) => {
      events.push({ type: event.type, payload: event.payload });
    });

    const tool = buildSignalGenerateTool(signals);
    const result = await tool.execute(
      {
        type: "automation.requested",
        data: { target: "deploy" }
      },
      contextBuild("agent-123"),
      toolCall
    );

    unsubscribe();

    expect(result.toolMessage.isError).toBe(false);
    const details = result.toolMessage.details as
      | { signal?: { type: string; source: { type: string; id?: string }; data?: unknown } }
      | undefined;
    expect(details?.signal?.type).toBe("automation.requested");
    expect(details?.signal?.source).toEqual({ type: "agent", id: "agent-123" });
    expect(details?.signal?.data).toEqual({ target: "deploy" });
    expect(events.some((event) => event.type === "signal.generated")).toBe(true);
  });
});

function contextBuild(agentId: string): ToolExecutionContext {
  return {
    connectorRegistry: null as unknown as ToolExecutionContext["connectorRegistry"],
    fileStore: null as unknown as ToolExecutionContext["fileStore"],
    auth: null as unknown as ToolExecutionContext["auth"],
    logger: console as unknown as ToolExecutionContext["logger"],
    assistant: null,
    permissions: {
      workingDir: "/tmp",
      writeDirs: ["/tmp"],
      readDirs: ["/tmp"],
      network: true
    },
    agent: { id: agentId } as unknown as ToolExecutionContext["agent"],
    source: "test",
    messageContext: {},
    agentSystem: null as unknown as ToolExecutionContext["agentSystem"],
    heartbeats: null as unknown as ToolExecutionContext["heartbeats"]
  };
}
