import type { FileReference } from "../files/types.js";

export type ConnectorMessage = {
  text: string | null;
  files?: FileReference[];
};

export type MessageContext = {
  channelId: string;
  userId: string | null;
  sessionId?: string;
  messageId?: string;
};

export type MessageHandler = (
  message: ConnectorMessage,
  context: MessageContext
) => void | Promise<void>;

export type MessageUnsubscribe = () => void;

export interface Connector {
  onMessage(handler: MessageHandler): MessageUnsubscribe;
  sendMessage(targetId: string, message: ConnectorMessage): Promise<void>;
  startTyping?: (targetId: string) => () => void;
  setReaction?: (
    targetId: string,
    messageId: string,
    reaction: string
  ) => Promise<void>;
  shutdown?: (reason?: string) => void | Promise<void>;
}
