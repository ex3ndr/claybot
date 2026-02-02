# Engine Agent Loop

The Agent owns the end-to-end agent loop:
- resolve permissions (cron/heartbeat)
- build the system prompt + tool context
- run the inference/tool loop
- persist state and emit outgoing events

```mermaid
flowchart TD
  Engine[engine.ts] --> Agent[agents/agent.ts]
  Agent --> Perms[permissions/*]
  Agent --> Prompt[agent.ts buildSystemPrompt]
  Agent --> Loop[agents/ops/agentLoopRun.ts]
  Loop --> Inference[inference/router.ts]
  Loop --> Tools[modules.ToolResolver]
  Agent --> Store[agents/ops/*]
  Loop --> Connector[connectors/*]
```

## Agent Creation

Agent creation is deterministic and does not depend on inbound message context.
Message delivery uses the inbound connector source; system messages derive the connector
from the target agent descriptor.

```mermaid
flowchart TD
  Create[Agent.create] --> Persist[descriptor.json + state.json]
  Message[Agent.handleMessage] --> Source[connector source]
  Source --> Send[connector.sendMessage]
```

## Bundled Prompt Resolution

System prompt templates are bundled under `sources/prompts/` and read through
`agentPromptBundledRead`.

```mermaid
flowchart LR
  Read[agentPromptBundledRead] --> Prompts[sources/prompts/*.md]
  Prompts --> System[buildSystemPrompt]
```

## Context Compaction

Long-running sessions can be compacted into a single summary message using the
COMPACTION prompt and a normal-size model selection.

```mermaid
flowchart LR
  Context[Context messages] --> Compact[agents/ops/contextCompact.ts]
  Compact --> Prompt[sources/prompts/COMPACTION.md]
  Compact --> Router[inference/router.ts]
  Router --> Model[normal-size model]
  Model --> Summary[assistant summary message]
```

## Emergency Context Reset

When inference returns a context overflow error, the session is hard reset and
foreground users are notified.

```mermaid
flowchart LR
  Inference[inference/router.ts] --> Overflow[context overflow error]
  Overflow --> Reset[Agent.handleEmergencyReset]
  Reset --> State[state.json + reset marker]
  Reset --> Notify[connector.sendMessage (foreground only)]
```

## Reset System Messages

Reset markers can carry an optional message that is injected as a system-level
note at the beginning of the next context so models understand why a reset happened.

```mermaid
flowchart LR
  ResetRecord[history.jsonl reset + message] --> Build[buildHistoryContext]
  Build --> SystemMsg[<system_message origin=\"system\">...]
  SystemMsg --> Context[context messages]
```

## State vs History

`state.json` only stores durable metadata (permissions, timestamps).
Conversation context is rebuilt from `history.jsonl` instead of being persisted in state.

```mermaid
flowchart LR
  State[state.json] --> Meta[permissions + timestamps]
  History[history.jsonl] --> Context[context messages]
  Context --> Loop[inference loop]
```

## Agent Sleep Mode

After processing a message or reset, the agent marks itself sleeping when the inbox is empty.
Sleeping agents are skipped on boot and only restored when a new inbox item arrives, which
wakes them before enqueueing.

```mermaid
sequenceDiagram
  participant Inbox
  participant Agent
  participant System
  participant Disk
  Agent->>System: sleepIfIdle()
  System->>Inbox: check empty
  System->>Disk: write state.sleeping=true
  Note right of Agent: skipped on boot
  Inbox-->>System: post item
  System->>Disk: write state.sleeping=false
  System->>Inbox: enqueue item
  System->>Agent: start/restore
```
