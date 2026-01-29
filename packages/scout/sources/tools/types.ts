import type { Tool, ToolResultMessage } from "@mariozechner/pi-ai";
import type { TSchema } from "@sinclair/typebox";

import type { FileReference } from "../files/types.js";
import type { MessageContext } from "../connectors/types.js";
import type { ConnectorRegistry } from "../connectors/registry.js";
import type { FileStore } from "../files/store.js";
import type { MemoryEngine } from "../memory/engine.js";
import type { Session } from "../sessions/session.js";
import type { SecretsStore } from "../secrets/store.js";
import type { Logger } from "pino";
import type { Pm2Runtime } from "../modules/runtime/pm2.js";
import type { DockerRuntime } from "../modules/runtime/containers.js";
import type { AssistantSettings } from "../settings.js";

export type ToolExecutionContext<State = Record<string, unknown>> = {
  connectorRegistry: ConnectorRegistry | null;
  fileStore: FileStore;
  memory: MemoryEngine | null;
  secrets: SecretsStore;
  logger: Logger;
  pm2Runtime: Pm2Runtime | null;
  dockerRuntime: DockerRuntime | null;
  assistant: AssistantSettings | null;
  session: Session<State>;
  source: string;
  messageContext: MessageContext;
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
