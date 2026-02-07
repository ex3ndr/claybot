# Agent idle event

## Summary

The agent lifecycle now includes an `idle` phase. When an agent transitions to `sleeping`, the system schedules a delayed idle emission for 60 seconds later.

If the agent wakes before the delay expires, the pending idle emission is canceled.

On successful idle transition, the engine emits:

- Engine event: `agent.idle`
- Lifecycle signal: `agent:<agentId>:idle`

## Lifecycle flow

```mermaid
sequenceDiagram
    participant A as AgentSystem
    participant T as Idle Timer (60s)
    participant E as Engine Event Bus
    participant S as Signals

    A->>E: emit agent.sleep
    A->>S: generate agent:<id>:sleep
    A->>T: schedule idle timeout (+60s)

    alt wakes before timeout
        A->>T: cancel timeout
        A->>E: emit agent.woke
        A->>S: generate agent:<id>:wake
    else remains sleeping for 60s
        T-->>A: timeout fires
        A->>E: emit agent.idle
        A->>S: generate agent:<id>:idle
    end
```
