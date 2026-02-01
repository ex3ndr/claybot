import { getLogger } from "../../log.js";
import type {
  Connector,
  ConnectorMessage,
  MessageHandler,
  MessageUnsubscribe
} from "../connectors/types.js";

const logger = getLogger("connectors.cron");

/**
 * Creates a cron connector for sending output from cron tasks.
 *
 * This connector is send-only; it logs output but does not receive messages.
 */
export function cronConnectorCreate(): Connector {
  const noopUnsubscribe: MessageUnsubscribe = () => {};

  return {
    capabilities: {
      sendText: true,
      messageFormatPrompt: "Messages sent via the cron connector are plain text with no markup or special formatting."
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
