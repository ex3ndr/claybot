export type AgentDescriptor =
  | { type: "user"; connector: string; userId: string; channelId: string }
  | { type: "cron"; id: string }
  | { type: "heartbeat" }
  | { type: "subagent"; id: string; parentAgentId: string; name: string };

export type AgentFetchStrategy = "most-recent-foreground" | "heartbeat";
