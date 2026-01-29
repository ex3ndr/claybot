import TelegramBot from "node-telegram-bot-api";

import type {
  Connector,
  ConnectorMessage,
  MessageContext,
  MessageHandler
} from "./types.js";

export type TelegramConnectorOptions = {
  token: string;
  polling?: boolean;
};

export class TelegramConnector implements Connector {
  private bot: TelegramBot;
  private handlers: MessageHandler[] = [];

  constructor(options: TelegramConnectorOptions) {
    this.bot = new TelegramBot(options.token, {
      polling: options.polling ?? true
    });

    this.bot.on("message", async (message) => {
      const payload: ConnectorMessage = {
        text: typeof message.text === "string" ? message.text : null
      };

      const context: MessageContext = {
        channelId: String(message.chat.id),
        userId: message.from ? String(message.from.id) : null
      };

      for (const handler of this.handlers) {
        await handler(payload, context);
      }
    });
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  async sendMessage(targetId: string, message: ConnectorMessage): Promise<void> {
    await this.bot.sendMessage(targetId, message.text ?? "");
  }
}
