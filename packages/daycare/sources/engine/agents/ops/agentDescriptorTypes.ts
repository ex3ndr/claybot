export type AgentDescriptor =
  | { type: "user"; connector: string; userId: string; channelId: string }
  | { type: "cron"; id: string; name?: string }
  | { type: "system"; tag: string }
  | { type: "subagent"; id: string; parentAgentId: string; name: string }
  | {
      type: "permanent";
      id: string;
      name: string;
      description: string;
      systemPrompt: string;
      workspaceDir?: string;
    };

export type AgentFetchStrategy = "most-recent-foreground" | "heartbeat";
