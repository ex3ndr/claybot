# Engine Agent Loop

The Agent owns the end-to-end session loop:
- resolve session permissions (cron/heartbeat)
- build the system prompt + tool context
- run the inference/tool loop
- persist state and emit outgoing events

```mermaid
flowchart TD
  Engine[engine.ts] --> Agent[agents/agent.ts]
  Agent --> Perms[permissions/*]
  Agent --> Prompt[createSystemPrompt.ts]
  Agent --> Loop[agents/agentLoopRun.ts]
  Loop --> Inference[inference/router.ts]
  Loop --> Tools[modules.ToolResolver]
  Loop --> Store[sessions/store.ts]
  Loop --> Connector[connectors/*]
```
