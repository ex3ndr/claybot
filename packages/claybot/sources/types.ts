// Central type re-exports for cross-cutting concerns.
// Import via: import type { ... } from "@/types";

// Permissions
export type { SessionPermissions } from "./engine/permissions.js";

// Scheduling
export type { ExecGateDefinition } from "./engine/scheduling/execGateTypes.js";

// Connectors
export type {
  Connector,
  ConnectorCapabilities,
  ConnectorFile,
  ConnectorFileDisposition,
  ConnectorFileMode,
  ConnectorMessage,
  CommandHandler,
  CommandUnsubscribe,
  MessageContext,
  MessageHandler,
  MessageUnsubscribe,
  PermissionAccess,
  PermissionDecision,
  PermissionHandler,
  PermissionKind,
  PermissionRequest
} from "./engine/modules/connectors/types.js";

// Files
export type { FileReference } from "./files/types.js";

// Plugins
export type {
  PluginApi,
  PluginInstance,
  PluginModule,
  PluginOnboardingApi,
  PluginOnboardingResult
} from "./engine/plugins/types.js";

// Agents
export type {
  AgentMessage,
  AgentState,
  AgentTokenEntry,
  AgentTokenSize,
  AgentTokenSnapshotSize,
  AgentTokenStats,
  AgentLifecycleState,
  AgentHistoryRecord,
  AgentInboxItem,
  AgentInboxResult,
  AgentPostTarget,
  BackgroundAgentState
} from "./engine/agents/ops/agentTypes.js";
export type { AgentDescriptor, AgentFetchStrategy } from "./engine/agents/ops/agentDescriptorTypes.js";

// Inference
export type {
  InferenceClient,
  InferenceProvider,
  InferenceProviderOptions
} from "./engine/modules/inference/types.js";

// Images
export type { ImageGenerationProvider } from "./engine/modules/images/types.js";

// Tools
export type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult
} from "./engine/modules/tools/types.js";

// Config
export type { Config } from "./config/configTypes.js";
