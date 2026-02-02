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

## State vs History

`state.json` only stores durable metadata (permissions, timestamps).
Conversation context is rebuilt from `history.jsonl` instead of being persisted in state.

```mermaid
flowchart LR
  State[state.json] --> Meta[permissions + timestamps]
  History[history.jsonl] --> Context[context messages]
  Context --> Loop[inference loop]
```
