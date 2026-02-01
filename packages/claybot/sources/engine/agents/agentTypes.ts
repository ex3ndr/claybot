import type { ConnectorMessage, MessageContext } from "../connectors/types.js";
import type { SessionDescriptor } from "../sessions/descriptor.js";
import type { SessionStore } from "../sessions/store.js";
import type { SessionState } from "../sessions/sessionStateTypes.js";
import type { SessionMessage } from "../sessions/types.js";
import type { SessionPermissions } from "../permissions.js";
import type { SettingsConfig } from "../../settings.js";
import type { ConnectorRegistry, ImageGenerationRegistry, ToolResolver } from "../modules.js";
import type { InferenceRouter } from "../inference/router.js";
import type { FileStore } from "../../files/store.js";
import type { AuthStore } from "../../auth/store.js";
import type { PluginManager } from "../plugins/manager.js";
import type { EngineEventBus } from "../ipc/events.js";
import type { CronStore } from "../cron/cronStore.js";
import type { CronScheduler } from "../cron/cronScheduler.js";
import type { AgentRuntime } from "../tools/types.js";

export type AgentEngine = {
  getSessionStore(): SessionStore<SessionState>;
  getDefaultPermissions(): SessionPermissions;
  getSettings(): SettingsConfig;
  getConfigDir(): string;
  getConnectorRegistry(): ConnectorRegistry;
  getImageRegistry(): ImageGenerationRegistry;
  getToolResolver(): ToolResolver;
  getInferenceRouter(): InferenceRouter;
  getFileStore(): FileStore;
  getAuthStore(): AuthStore;
  getPluginManager(): PluginManager;
  getEventBus(): EngineEventBus;
  getCronStore(): CronStore | null;
  getCronScheduler(): CronScheduler | null;
  getAgentRuntime(): AgentRuntime;
  isVerbose(): boolean;
};

export type AgentInboundMessage = {
  source: string;
  message: ConnectorMessage;
  context: MessageContext;
};

export type AgentDescriptor = SessionDescriptor;

export type AgentReceiveResult = SessionMessage;
