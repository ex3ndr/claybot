import type { ConnectorMessage, MessageContext } from "@/types";
import { formatTimeAI } from "../../util/timeFormat.js";

export function messageFormatIncoming(
  message: ConnectorMessage,
  context: MessageContext,
  receivedAt: Date
): ConnectorMessage {
  if (!message.text && (!message.files || message.files.length === 0)) {
    return message;
  }
  const time = formatTimeAI(receivedAt);
  const text = message.text ?? "";
  const messageIdTag = context.messageId
    ? `<message_id>${context.messageId}</message_id>`
    : "";
  return {
    ...message,
    rawText: message.rawText ?? message.text,
    text: `<time>${time}</time>${messageIdTag}<message>${text}</message>`
  };
}
