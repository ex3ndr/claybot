// Central type re-exports for cross-cutting concerns.
// Import via: import type { ... } from "@/types";

// Permissions
export type { SessionPermissions } from "./engine/permissions.js";

// Connectors
export type {
  ConnectorCapabilities,
  ConnectorFile,
  ConnectorFileDisposition,
  ConnectorFileMode,
  ConnectorMessage,
  MessageContext,
  PermissionAccess,
  PermissionDecision,
  PermissionKind,
  PermissionRequest
} from "./engine/connectors/types.js";

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

// Sessions
export type { SessionMessage } from "./engine/sessions/types.js";

// Inference
export type {
  InferenceClient,
  InferenceProvider,
  InferenceProviderOptions
} from "./engine/inference/types.js";

// Images
export type { ImageGenerationProvider } from "./engine/images/types.js";

// Tools
export type {
  AgentRuntime,
  ToolExecutionContext,
  ToolExecutionResult
} from "./engine/tools/types.js";
