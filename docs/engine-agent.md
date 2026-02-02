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
