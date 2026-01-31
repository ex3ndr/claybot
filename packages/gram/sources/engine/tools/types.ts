import type { Tool, ToolResultMessage } from "@mariozechner/pi-ai";
import type { TSchema } from "@sinclair/typebox";

import type { FileReference } from "../../files/types.js";
import type { ConnectorRegistry } from "../modules.js";
import type { FileStore } from "../../files/store.js";
import type { Session } from "../sessions/session.js";
import type { AuthStore } from "../../auth/store.js";
import type { Logger } from "pino";
import type { AssistantSettings } from "../../settings.js";
import type { SessionPermissions } from "../permissions.js";

export type BackgroundAgentStartArgs = {
  prompt: string;
  sessionId?: string;
  name?: string;
  parentSessionId?: string;
};

export type BackgroundAgentStartResult = {
  sessionId: string;
};

export type SessionMessageArgs = {
  sessionId?: string;
  text: string;
  origin?: "background" | "system";
};

export type HeartbeatRunArgs = {
  ids?: string[];
};

export type HeartbeatRunResult = {
  ran: number;
  taskIds: string[];
};

export type AgentRuntime = {
  startBackgroundAgent: (
    args: BackgroundAgentStartArgs
  ) => Promise<BackgroundAgentStartResult>;
  sendSessionMessage: (args: SessionMessageArgs) => Promise<void>;
  runHeartbeatNow: (args?: HeartbeatRunArgs) => Promise<HeartbeatRunResult>;
};

export type ToolExecutionContext<State = Record<string, unknown>> = {
  connectorRegistry: ConnectorRegistry | null;
  fileStore: FileStore;
  auth: AuthStore;
  logger: Logger;
  assistant: AssistantSettings | null;
  permissions: SessionPermissions;
  session: Session<State>;
  source: string;
  messageContext: MessageContext;
  agentRuntime?: AgentRuntime;
};

export type ToolExecutionResult = {
  toolMessage: ToolResultMessage;
  files?: FileReference[];
};

export type ToolDefinition<TParams extends TSchema = TSchema> = {
  tool: Tool<TParams>;
  execute: (
    args: unknown,
    context: ToolExecutionContext,
    toolCall: { id: string; name: string }
  ) => Promise<ToolExecutionResult>;
};
