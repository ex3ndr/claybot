import { getLogger } from "../../log.js";
import type {
  Connector,
  ConnectorMessage,
  MessageHandler,
  MessageUnsubscribe
} from "./types.js";

const logger = getLogger("connectors.cron");

export function createCronConnector(): Connector {
  const noopUnsubscribe: MessageUnsubscribe = () => {};

  return {
    capabilities: {
      sendText: true
    },
    onMessage: (_handler: MessageHandler) => {
      return noopUnsubscribe;
    },
    async sendMessage(targetId: string, message: ConnectorMessage): Promise<void> {
      logger.info(
        { targetId, textLength: message.text?.length ?? 0, fileCount: message.files?.length ?? 0 },
        "Cron output"
      );
    }
  };
}
