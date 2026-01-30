import type { ConnectorMessage, MessageContext } from "../connectors/types.js";
import type { FileReference } from "../../files/types.js";

export type SessionMessage = {
  id: string;
  message: ConnectorMessage;
  context: MessageContext;
  receivedAt: Date;
};

export type SessionContext<State = Record<string, unknown>> = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  state: State;
};

export type SessionSummary = {
  sessionId: string;
  storageId: string;
  source: string;
  context: MessageContext;
  createdAt?: Date;
  updatedAt?: Date;
  lastMessage?: string | null;
  lastFiles?: FileReference[];
};

export type SessionRoute =
  | { type: "main" }
  | { type: "session"; id: string }
  | { type: "new"; id?: string };

export type SessionRouter = (
  message: ConnectorMessage,
  context: MessageContext
) => SessionRoute | null | undefined;
