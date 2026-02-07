# Agent types

Agent types are persisted descriptors that capture what an agent represents
and how it should be resolved later. They are written once on creation and
restored on boot to keep agent identity stable across restarts.

```mermaid
flowchart TD
  Create[Agent created] --> Descriptor[descriptor.json]
  Create --> State[state.json]
  Create --> History[history.jsonl]
  Boot[Engine boot] --> Load[AgentSystem.load]
  Load --> Restore[enqueue restore]
  Restore --> Resolver[Agent resolver]
```

## Descriptor shape

Agent descriptors live in `agents/<id>/descriptor.json`.

```ts
type AgentDescriptor =
  | { type: "user"; connector: string; userId: string; channelId: string }
  | { type: "cron"; id: string }
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
```

Notes:
- `user` is a foreground connector conversation.
- `cron` maps to a scheduled task uid.
- `system` maps to built-in tag-addressable agents (for example `heartbeat`, `architect`).
- `subagent` is any background agent and always includes a parent + name.
- `permanent` is a background agent with a stable name, short description, system prompt, and optional workspace folder.

## System agent registry

System agents are defined in a hardcoded list by lowercase tag and prompt file.
Each entry can also opt into full system-prompt replacement.

```mermaid
flowchart LR
  Config[_systemAgents.ts] --> Resolve[systemAgentPromptResolve]
  Resolve --> PromptFiles[prompts/*.md]
  Resolve --> Agent[Agent.buildSystemPrompt]
  Agent -->|replaceSystemPrompt=false| BaseTemplate[SYSTEM.md + sections]
  Agent -->|replaceSystemPrompt=true| DedicatedPrompt[system prompt replaced]
```

## Permanent agents

Permanent agents are created via tool calls and persisted like any other agent,
but their descriptors carry a stable name + system prompt for reuse.

```mermaid
sequenceDiagram
  participant Foreground
  participant Tool
  participant AgentStore
  participant AgentSystem
  Foreground->>Tool: create_permanent_agent(name, description, systemPrompt)
  Tool->>AgentStore: write descriptor/state/history
  Tool->>AgentSystem: update in-memory descriptor/permissions (if loaded)
  Tool-->>Foreground: permanent agent id
```

## Persistence rules

1. On agent creation, the engine writes `descriptor.json` and `state.json`.
2. `history.jsonl` stores minimal `start`/`reset` markers plus user/assistant/tool records.
3. On restart, AgentSystem loads descriptor + state and queues a restore message.
4. History is reconstructed starting after the most recent `start` or `reset` marker.

## Fetch strategies

Only two fetch strategies are supported:

```ts
type AgentFetchStrategy = "most-recent-foreground" | "heartbeat";
```

Resolution behavior:
- `most-recent-foreground` selects the most recent agent with a `user` descriptor.
- `heartbeat` selects the most recent agent with `type: "system"` and `tag: "heartbeat"`.

## How agent types operate together

```mermaid
flowchart LR
  User[User agent] -->|spawns| Subagent[Subagent]
  Cron[Cron agent] -->|spawns| Subagent
  Heartbeat[Heartbeat scheduler] -->|batch prompt| HeartbeatAgent[System agent: heartbeat]
  Architect[Planner flow] -->|specialized prompt| ArchitectAgent[System agent: architect]
  Subagent -->|send_agent_message| User
```

Operational notes:
- User agents are the only agents treated as foreground.
- Subagents always have a parent (usually a user agent, cron, or a system agent).
- Heartbeat runs always map to a single `system:heartbeat` agent that runs a batch prompt.
- Cron agents are scheduled inputs; they can spawn subagents but are not foreground targets.

## Message delivery

### User message to agent

```mermaid
sequenceDiagram
  participant User
  participant Connector
  participant AgentSystem
  participant Agent
  User->>Connector: message
  Connector->>AgentSystem: connector.message
  AgentSystem->>Agent: resolve agent id + enqueue
  Agent-->>Connector: response
```

Delivery notes:
- Agent id is resolved from the persisted `user` descriptor (connector + user + channel).
- The agent inbox preserves ordering; updates are persisted on each step.

### Agent to subagent

```mermaid
sequenceDiagram
  participant Agent
  participant AgentSystem
  participant Subagent
  Agent->>AgentSystem: post(subagent message)
  AgentSystem->>Subagent: create background agent (new id)
  Subagent->>AgentSystem: process inbox
```

Delivery notes:
- Subagents always carry `parentAgentId` and `name`.
- Each subagent starts with a new cuid2 id; existing ids are not reused.
- The subagent descriptor is persisted on creation.

### Subagent back to user

```mermaid
sequenceDiagram
  participant Subagent
  participant AgentSystem
  participant User
  Subagent->>AgentSystem: agentFor("most-recent-foreground")
  AgentSystem-->>Subagent: agentId
  Subagent->>AgentSystem: post(system message)
  AgentSystem->>User: system message
```

Delivery notes:
- The `most-recent-foreground` strategy selects the most recent `user` agent.
- Subagents default to their `parentAgentId`; other agents fall back to
  `most-recent-foreground` when no agent id is provided.

### Permission request via foreground agent

Background agents cannot request permissions directly. They use
`request_permission`, which routes through the most recent foreground agent.

```mermaid
sequenceDiagram
  participant Subagent
  participant Engine
  participant Connector
  participant User
  Subagent->>Engine: request_permission
  Engine->>Connector: requestPermission (via foreground target)
  Connector->>User: permission request
  User->>Connector: approve/deny
  Connector->>Engine: permission decision (agentId)
  Engine->>Subagent: permission decision
  Subagent->>Subagent: permissionApply
```

Delivery notes:
- Permission requests include the requesting agent id.
- When a decision arrives, the engine routes it directly to that agent.

## Restore behavior

On startup the engine loads agents from disk and enqueues a restore message.
Restore reconstructs inference context from history after the latest reset/start
marker; it does not retry pending inbound messages.

## Implementation references

- Descriptor type + normalization: `packages/daycare/sources/engine/agents/ops/agentDescriptorTypes.ts`
- System-agent config + prompt resolution: `packages/daycare/sources/engine/agents/system/`
- Persistence ops: `packages/daycare/sources/engine/agents/ops/`
- Resolver + usage: `packages/daycare/sources/engine/agents/agentSystem.ts`
