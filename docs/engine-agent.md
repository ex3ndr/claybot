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
