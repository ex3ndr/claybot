import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FileStore } from "../../files/store.js";
import type { AgentDescriptor, MessageContext, PermissionRequest } from "@/types";

type Handler = (payload: unknown) => void | Promise<void>;
type MockFn = ReturnType<typeof vi.fn>;
type TelegramBotMock = {
  handlers: Map<string, Handler[]>;
  sendMessage: MockFn;
  editMessageText: MockFn;
  answerCallbackQuery: MockFn;
  startPolling: MockFn;
  deleteWebHook: MockFn;
};

const telegramInstances: TelegramBotMock[] = [];

vi.mock("node-telegram-bot-api", () => {
  class TelegramBotMockClass {
    handlers = new Map<string, Handler[]>();
    sendMessage = vi.fn(async () => ({ message_id: 101, chat: { id: 123 } }));
    editMessageText = vi.fn(async () => undefined);
    answerCallbackQuery = vi.fn(async () => undefined);
    isPolling = vi.fn(() => false);
    startPolling = vi.fn(async () => undefined);
    stopPolling = vi.fn(async () => undefined);
    deleteWebHook = vi.fn(async () => undefined);

    constructor() {
      telegramInstances.push(this as unknown as TelegramBotMock);
    }

    on(event: string, handler: Handler): void {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
    }

    processUpdate(_update: unknown): void {}
  }

  return { default: TelegramBotMockClass };
});

import { TelegramConnector } from "./connector.js";

describe("TelegramConnector permissions", () => {
  beforeEach(() => {
    telegramInstances.length = 0;
  });

  it("edits the permission prompt when approved", async () => {
    const fileStore = { saveFromPath: vi.fn() } as unknown as FileStore;
    const connector = new TelegramConnector({
      token: "token",
      allowedUids: ["123"],
      polling: false,
      clearWebhook: false,
      statePath: null,
      fileStore,
      dataDir: "/tmp",
      enableGracefulShutdown: false
    });

    const request: PermissionRequest = {
      token: "perm-1",
      agentId: "agent-1",
      reason: "Need read access",
      message: "Permission request",
      permission: "@read:/tmp",
      access: { kind: "read", path: "/tmp" },
      requester: {
        id: "agent-1",
        type: "subagent",
        label: "file-checker",
        kind: "background"
      }
    };
    const context: MessageContext = { messageId: "msg-1" };
    const descriptor: AgentDescriptor = {
      type: "user",
      connector: "telegram",
      userId: "123",
      channelId: "123"
    };

    await connector.requestPermission("123", request, context, descriptor);

    const bot = telegramInstances[0];
    expect(bot).toBeTruthy();
    expect(bot!.sendMessage).toHaveBeenCalledTimes(1);
    const call = bot!.sendMessage.mock.calls[0];
    expect(call).toBeTruthy();
    const options = call?.[2] as {
      parse_mode?: string;
      reply_markup?: { inline_keyboard?: Array<Array<{ text?: string }>> };
    };
    expect(options.parse_mode).toBe("HTML");
    expect(options.reply_markup?.inline_keyboard?.[0]?.[0]?.text).toBe("Allow");

    const handler = bot!.handlers.get("callback_query")?.[0];
    expect(handler).toBeTruthy();
    await handler?.({
      id: "cb-1",
      from: { id: 123 },
      data: "perm:allow:perm-1",
      message: { message_id: 44, chat: { id: 123 } }
    });

    expect(bot!.editMessageText).toHaveBeenCalledTimes(1);
    const editCall = bot!.editMessageText.mock.calls[0];
    expect(editCall).toBeTruthy();
    const editText = editCall?.[0];
    const editOptions = editCall?.[1];
    expect(String(editText)).toContain("Permission granted");
    expect(editOptions).toMatchObject({
      chat_id: 123,
      message_id: 44,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] }
    });
  });
});

describe("TelegramConnector commands", () => {
  beforeEach(() => {
    telegramInstances.length = 0;
  });

  it("routes /reset to command handlers", async () => {
    const fileStore = { saveFromPath: vi.fn() } as unknown as FileStore;
    const connector = new TelegramConnector({
      token: "token",
      allowedUids: ["123"],
      polling: false,
      clearWebhook: false,
      statePath: null,
      fileStore,
      dataDir: "/tmp",
      enableGracefulShutdown: false
    });

    const messageHandlerMock = vi.fn(async (_message, _context, _descriptor) => undefined);
    const commandHandler = vi.fn(async (_command, _context, _descriptor) => undefined);
    connector.onMessage(messageHandlerMock);
    connector.onCommand(commandHandler);

    const bot = telegramInstances[0];
    expect(bot).toBeTruthy();
    const botMessageHandler = bot!.handlers.get("message")?.[0];
    await botMessageHandler?.({
      message_id: 55,
      chat: { id: 123, type: "private" },
      from: { id: 123 },
      text: "/reset"
    });

    expect(messageHandlerMock).not.toHaveBeenCalled();
    expect(commandHandler).toHaveBeenCalledTimes(1);
    const [command, context, descriptor] = commandHandler.mock.calls[0] as [
      string,
      MessageContext,
      AgentDescriptor
    ];
    expect(command).toBe("/reset");
    expect(context).toMatchObject({ messageId: "55" });
    expect(descriptor).toMatchObject({
      type: "user",
      connector: "telegram",
      channelId: "123",
      userId: "123"
    });
  });
});

describe("TelegramConnector polling", () => {
  beforeEach(() => {
    telegramInstances.length = 0;
  });

  it("clears the webhook on polling conflict without local retry", async () => {
    const fileStore = { saveFromPath: vi.fn() } as unknown as FileStore;
    const connector = new TelegramConnector({
      token: "token",
      allowedUids: ["123"],
      polling: false,
      clearWebhook: false,
      statePath: null,
      fileStore,
      dataDir: "/tmp",
      enableGracefulShutdown: false
    });

    const bot = telegramInstances[0];
    expect(bot).toBeTruthy();

    const pollingErrorHandler = bot!.handlers.get("polling_error")?.[0];
    expect(pollingErrorHandler).toBeTruthy();

    bot!.deleteWebHook.mockClear();
    bot!.startPolling.mockClear();

    pollingErrorHandler?.({ code: "ETELEGRAM", response: { statusCode: 409 } });
    await Promise.resolve();

    expect(bot!.deleteWebHook).toHaveBeenCalledTimes(1);
    expect(bot!.startPolling).not.toHaveBeenCalled();
    void connector;
  });
});
