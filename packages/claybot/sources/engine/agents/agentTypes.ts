import type { Config } from "../../config/configTypes.js";
import type { AuthStore } from "../../auth/store.js";
import type { FileStore } from "../../files/store.js";
import type { ConnectorRegistry } from "../modules/connectorRegistry.js";
import type { ImageGenerationRegistry } from "../modules/imageGenerationRegistry.js";
import type { ToolResolver } from "../modules/toolResolver.js";
import type { InferenceRouter } from "../modules/inference/router.js";
import type { ConnectorMessage, MessageContext } from "../modules/connectors/types.js";
import type { AgentRuntime } from "../modules/tools/types.js";
import type { PluginManager } from "../plugins/manager.js";
import type { Crons } from "../cron/crons.js";
import type { SessionDescriptor } from "../sessions/descriptor.js";
import type { SessionMessage } from "../sessions/types.js";
import type { SessionState } from "../sessions/sessionStateTypes.js";
import type { SessionStore } from "../sessions/store.js";
import type { EngineEventBus } from "../ipc/events.js";

export type AgentInboundMessage = {
  source: string;
  message: ConnectorMessage;
  context: MessageContext;
};

export type AgentDescriptor = SessionDescriptor;

export type AgentReceiveResult = SessionMessage;

export type BackgroundAgentState = {
  sessionId: string;
  storageId: string;
  name?: string;
  parentSessionId?: string;
  status: "running" | "queued" | "idle";
  pending: number;
  updatedAt?: string;
};

export type AgentSystemContext = {
  readonly config: Config;
  readonly sessionStore: SessionStore<SessionState>;
  readonly connectorRegistry: ConnectorRegistry;
  readonly imageRegistry: ImageGenerationRegistry;
  readonly toolResolver: ToolResolver;
  readonly inferenceRouter: InferenceRouter;
  readonly fileStore: FileStore;
  readonly authStore: AuthStore;
  readonly pluginManager: PluginManager;
  readonly eventBus: EngineEventBus;
  readonly crons: Crons;
  readonly agentRuntime: AgentRuntime;
};
