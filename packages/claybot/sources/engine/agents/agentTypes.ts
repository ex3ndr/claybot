import type { ConnectorMessage, MessageContext } from "../connectors/types.js";
import type { SessionDescriptor } from "../sessions/descriptor.js";
import type { SessionStore } from "../sessions/store.js";
import type { SessionState } from "../sessions/sessionStateTypes.js";
import type { SessionMessage } from "../sessions/types.js";
import type { SessionPermissions } from "../permissions.js";

export type AgentEngine = {
  getSessionStore(): SessionStore<SessionState>;
  getDefaultPermissions(): SessionPermissions;
};

export type AgentInboundMessage = {
  source: string;
  message: ConnectorMessage;
  context: MessageContext;
};

export type AgentDescriptor = SessionDescriptor;

export type AgentReceiveResult = SessionMessage;
