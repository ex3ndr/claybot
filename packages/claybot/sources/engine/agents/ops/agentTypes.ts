import type { Context, ToolCall } from "@mariozechner/pi-ai";

import type {
  ConnectorMessage,
  FileReference,
  MessageContext,
  PermissionDecision,
  SessionPermissions,
  ToolExecutionResult
} from "@/types";
import type { AgentDescriptor } from "./agentDescriptorTypes.js";

export type AgentMessage = {
  id: string;
  message: ConnectorMessage;
  context: MessageContext;
  receivedAt: number;
};

export type AgentTokenSize = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type AgentTokenSnapshotSize = AgentTokenSize & {
  total: number;
};

export type AgentTokenEntry = {
  provider: string;
  model: string;
  size: AgentTokenSnapshotSize;
};

export type AgentTokenStats = Record<string, Record<string, AgentTokenSize>>;

export type AgentState = {
  context: Context;
  permissions: SessionPermissions;
  tokens: AgentTokenEntry | null;
  stats: AgentTokenStats;
  createdAt: number;
  updatedAt: number;
  state: AgentLifecycleState;
};

export type AgentLifecycleState = "active" | "sleeping";

export type AgentHistoryRecord =
  | { type: "start"; at: number }
  | { type: "reset"; at: number; message?: string }
  | {
      type: "user_message";
      at: number;
      text: string;
      files: FileReference[];
    }
  | {
      type: "assistant_message";
      at: number;
      text: string;
      files: FileReference[];
      toolCalls: ToolCall[];
      tokens: AgentTokenEntry | null;
    }
  | {
      type: "tool_result";
      at: number;
      toolCallId: string;
      output: ToolExecutionResult;
    }
  | { type: "note"; at: number; text: string };

export type AgentInboxItem =
  | {
      type: "message";
      message: ConnectorMessage;
      context: MessageContext;
    }
  | {
      type: "system_message";
      text: string;
      origin?: string;
      silent?: boolean;
      context?: MessageContext;
    }
  | {
      type: "reset";
      message?: string;
    }
  | {
      type: "permission";
      decision: PermissionDecision;
      context: MessageContext;
    }
  | {
      type: "restore";
    };

export type AgentInboxMessage = Extract<AgentInboxItem, { type: "message" }>;
export type AgentInboxSystemMessage = Extract<
  AgentInboxItem,
  { type: "system_message" }
>;

export type AgentInboxReset = Extract<AgentInboxItem, { type: "reset" }>;
export type AgentInboxRestore = Extract<AgentInboxItem, { type: "restore" }>;
export type AgentInboxPermission = Extract<AgentInboxItem, { type: "permission" }>;

export type AgentInboxResult =
  | {
      type: "message";
      responseText: string | null;
    }
  | {
      type: "system_message";
      responseText: string | null;
    }
  | {
      type: "reset";
      ok: boolean;
    }
  | {
      type: "restore";
      ok: boolean;
    }
  | {
      type: "permission";
      ok: boolean;
    };

export type AgentInboxCompletion = {
  resolve: (result: AgentInboxResult) => void;
  reject: (error: Error) => void;
};

export type AgentInboxEntry = {
  id: string;
  postedAt: number;
  item: AgentInboxItem;
  completion: AgentInboxCompletion | null;
};

export type AgentPostTarget =
  | { agentId: string }
  | { descriptor: AgentDescriptor };

export type BackgroundAgentState = {
  agentId: string;
  name: string | null;
  parentAgentId: string | null;
  lifecycle: AgentLifecycleState;
  status: "running" | "queued" | "idle";
  pending: number;
  updatedAt: number;
};
