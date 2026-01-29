export type ConnectorMessage = {
  text: string | null;
};

export type MessageContext = {
  channelId: string;
  userId: string | null;
  sessionId?: string;
};

export type MessageHandler = (
  message: ConnectorMessage,
  context: MessageContext
) => void | Promise<void>;

export interface Connector {
  onMessage(handler: MessageHandler): void;
  sendMessage(targetId: string, message: ConnectorMessage): Promise<void>;
}
