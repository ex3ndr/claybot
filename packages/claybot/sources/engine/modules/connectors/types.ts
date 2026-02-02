import type { FileReference } from "../../../files/types.js";

export type ConnectorFileMode = "document" | "photo" | "video";
export type ConnectorFileDisposition = ConnectorFileMode | "auto";

export type ConnectorFile = FileReference & {
  sendAs?: ConnectorFileDisposition;
};

export type ConnectorCapabilities = {
  sendText: boolean;
  sendFiles?: {
    modes: ConnectorFileMode[];
  };
  messageFormatPrompt?: string;
  reactions?: boolean;
  typing?: boolean;
};

export type ConnectorMessage = {
  text: string | null;
  rawText?: string | null;
  files?: ConnectorFile[];
  replyToMessageId?: string;
};

export type MessageContext = {
  channelId: string;
  userId: string;
  messageId?: string;
};

export type MessageHandler = (
  message: ConnectorMessage,
  context: MessageContext
) => void | Promise<void>;

export type MessageUnsubscribe = () => void;

export type PermissionKind = "read" | "write" | "web";

export type PermissionAccess =
  | { kind: "web" }
  | { kind: "read"; path: string }
  | { kind: "write"; path: string };

export type PermissionRequest = {
  token: string;
  reason: string;
  message: string;
  permission: string;
  access: PermissionAccess;
};

export type PermissionDecision = {
  token: string;
  approved: boolean;
  permission: string;
  access: PermissionAccess;
};

export type PermissionHandler = (
  decision: PermissionDecision,
  context: MessageContext
) => void | Promise<void>;

export interface Connector {
  capabilities: ConnectorCapabilities;
  onMessage(handler: MessageHandler): MessageUnsubscribe;
  onPermission?: (handler: PermissionHandler) => MessageUnsubscribe;
  sendMessage(targetId: string, message: ConnectorMessage): Promise<void>;
  requestPermission?: (
    targetId: string,
    request: PermissionRequest,
    context: MessageContext
  ) => Promise<void>;
  startTyping?: (targetId: string) => () => void;
  setReaction?: (
    targetId: string,
    messageId: string,
    reaction: string
  ) => Promise<void>;
  shutdown?: (reason?: string) => void | Promise<void>;
}
