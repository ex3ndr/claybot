import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { AgentDescriptor, Connector, MessageContext } from "@/types";
import { configResolve } from "../config/configResolve.js";
import { Engine } from "./engine.js";
import { EngineEventBus } from "./ipc/events.js";

describe("Engine reset command", () => {
  it("posts reset with message context for user commands", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "daycare-engine-"));
    try {
      const config = configResolve(
        { engine: { dataDir: dir }, assistant: { workspaceDir: dir } },
        path.join(dir, "settings.json")
      );
      const engine = new Engine({ config, eventBus: new EngineEventBus() });
      const postSpy = vi.spyOn(engine.agentSystem, "post").mockResolvedValue(undefined);

      const sendMessage = vi.fn(async () => undefined);
      const commandState: {
        handler?: (command: string, context: MessageContext, descriptor: AgentDescriptor) => void | Promise<void>;
      } = {};

      const connector: Connector = {
        capabilities: { sendText: true },
        onMessage: () => () => undefined,
        onCommand: (handler) => {
          commandState.handler = handler;
          return () => undefined;
        },
        sendMessage
      };

      const registerResult = engine.modules.connectors.register("telegram", connector);
      expect(registerResult).toEqual({ ok: true, status: "loaded" });
      const commandHandler = commandState.handler;
      if (!commandHandler) {
        throw new Error("Expected command handler to be registered");
      }

      const descriptor: AgentDescriptor = {
        type: "user",
        connector: "telegram",
        channelId: "123",
        userId: "123"
      };
      const context: MessageContext = { messageId: "55" };

      await commandHandler("/reset", context, descriptor);

      expect(postSpy).toHaveBeenCalledWith(
        { descriptor },
        { type: "reset", message: "Manual reset requested by the user.", context }
      );
      expect(sendMessage).not.toHaveBeenCalled();

      await engine.modules.connectors.unregisterAll("test");
      await engine.shutdown();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Engine stop command", () => {
  it("aborts active inference for user commands and confirms in channel", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "daycare-engine-"));
    try {
      const config = configResolve(
        { engine: { dataDir: dir }, assistant: { workspaceDir: dir } },
        path.join(dir, "settings.json")
      );
      const engine = new Engine({ config, eventBus: new EngineEventBus() });
      vi.spyOn(engine.agentSystem, "abortInferenceForTarget").mockReturnValue(true);
      const postSpy = vi.spyOn(engine.agentSystem, "post").mockResolvedValue(undefined);

      const sendMessage = vi.fn(async () => undefined);
      const commandState: {
        handler?: (command: string, context: MessageContext, descriptor: AgentDescriptor) => void | Promise<void>;
      } = {};

      const connector: Connector = {
        capabilities: { sendText: true },
        onMessage: () => () => undefined,
        onCommand: (handler) => {
          commandState.handler = handler;
          return () => undefined;
        },
        sendMessage
      };

      const registerResult = engine.modules.connectors.register("telegram", connector);
      expect(registerResult).toEqual({ ok: true, status: "loaded" });
      const commandHandler = commandState.handler;
      if (!commandHandler) {
        throw new Error("Expected command handler to be registered");
      }

      const descriptor: AgentDescriptor = {
        type: "user",
        connector: "telegram",
        channelId: "123",
        userId: "123"
      };
      const context: MessageContext = { messageId: "56" };

      await commandHandler("/stop", context, descriptor);

      expect(engine.agentSystem.abortInferenceForTarget).toHaveBeenCalledWith({ descriptor });
      expect(sendMessage).toHaveBeenCalledWith("123", {
        text: "Stopped current inference.",
        replyToMessageId: "56"
      });
      expect(postSpy).not.toHaveBeenCalled();

      await engine.modules.connectors.unregisterAll("test");
      await engine.shutdown();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
