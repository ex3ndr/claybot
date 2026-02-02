# AgentSystem

AgentSystem owns inbox-backed agent lifecycle:
- load agent descriptors/state with Zod validation + create inboxes
- route posts by agent id or descriptor
- start background agents and dispatch messages
- expose agent info for status/history/reset

AgentSystem boots in stages:
1. **load()** scans `agents/<id>/` for `descriptor.json` + `state.json`, creates inboxes, queues restore (no execution)
2. **start()** starts inbox loops for loaded agents and any newly created agents

```mermaid
flowchart TD
  Engine[engine.ts] --> AgentSystem[agents/agentSystem.ts]
  AgentSystem --> Ops[agents/ops/*Read.ts]
  Ops --> Store[agents/<id>/descriptor.json
state.json
history.jsonl]
  AgentSystem --> Inbox[agents/ops/agentInbox.ts]
  Inbox --> Agent[agents/agent.ts]
  Agent --> Loop[agents/ops/agentLoopRun.ts]
  AgentSystem --> Connectors[modules/connectorRegistry.ts]
  AgentSystem --> Tools[modules/toolResolver.ts]
  AgentSystem --> Inference[inference/router.ts]
```
