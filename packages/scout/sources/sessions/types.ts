import type { ConnectorMessage, MessageContext } from "../connectors/types.js";

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

export type SessionRoute =
  | { type: "main" }
  | { type: "session"; id: string }
  | { type: "new"; id?: string };

export type SessionRouter = (
  message: ConnectorMessage,
  context: MessageContext
) => SessionRoute | null | undefined;
