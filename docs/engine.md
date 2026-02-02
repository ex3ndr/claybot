# Engine updates

ClayBot updates engine settings using a three-step strategy:

1. **Local server running**: send a mutation request over the local HTTP socket
   at `.claybot/claybot.sock`.
2. **Local server not running**: write directly to local files
   (settings + auth).
3. **Remote server configured**: reserved for future use.

## Local socket
The `start` command launches a Fastify server bound to a Unix socket.

Current endpoints:
- `GET /v1/engine/status`
- `GET /v1/engine/cron/tasks`
- `GET /v1/engine/heartbeat/tasks`
- `GET /v1/engine/agents`
- `GET /v1/engine/agents/background`
- `GET /v1/engine/agents/:agentId/history`
- `POST /v1/engine/agents/:agentId/reset`
- `GET /v1/engine/plugins`
- `POST /v1/engine/plugins/load`
- `POST /v1/engine/plugins/unload`
- `POST /v1/engine/auth`
- `GET /v1/engine/events` (SSE)

Plugin mutations accept:
- `POST /v1/engine/plugins/load` payload `{ "pluginId": "...", "instanceId": "...", "settings": { ... } }`
- `POST /v1/engine/plugins/unload` payload `{ "instanceId": "..." }`

## Status payload (named entities)
The status response returns display names alongside ids for use in the dashboard.

```mermaid
classDiagram
  class EngineStatus {
    plugins: PluginSummary[]
    connectors: ConnectorSummary[]
    providers: ProviderSummary[]
    inferenceProviders: ProviderSummary[]
    imageProviders: ProviderSummary[]
  }
  class PluginSummary {
    id: string
    pluginId: string
    name: string
  }
  class ConnectorSummary {
    id: string
    pluginId: string
    name: string
    loadedAt: string
  }
  class ProviderSummary {
    id: string
    name: string
    label: string
  }
  EngineStatus --> PluginSummary
  EngineStatus --> ConnectorSummary
  EngineStatus --> ProviderSummary
```

## Heartbeat batch execution

Heartbeat tasks are collected and executed as a single heartbeat inference call.
`lastRunAt` is tracked as a single global timestamp and applied to each task entry. Each task still emits `heartbeat.task.ran`.

```mermaid
flowchart TD
  Scheduler[HeartbeatScheduler] -->|list tasks| Tasks[Heartbeat tasks]
  Tasks -->|batch prompt| HeartbeatAgent[Heartbeat agent]
  HeartbeatAgent -->|single inference call| Provider[Inference provider]
  HeartbeatAgent -->|record run per task| Store[Heartbeat state]
  Scheduler --> Events[Event bus]
```

## Agent descriptor persistence

Each agent writes `descriptor.json` and `state.json` under `agents/<id>/`. On startup, the engine loads
those files and enqueues a restore message so the agent can rebuild inference context from history.
Fetch strategies are limited to `most-recent-foreground` and `heartbeat`.

```mermaid
flowchart TD
  Create[agent.created] --> Descriptor[descriptor.json]
  Create --> State[state.json]
  Create --> History[history.jsonl]
  Boot[Engine boot] --> Load[AgentSystem.load]
  Load --> Restore[enqueue restore]
  Restore --> Resolver[Agent resolver]
```

```mermaid
sequenceDiagram
  participant Client
  participant Engine
  Client->>Engine: POST /v1/engine/plugins/load
  Engine->>Engine: load plugin + update settings
  Engine-->>Client: ok
  Client->>Engine: GET /v1/engine/events
  Engine-->>Client: stream events
```

## Permission requests

Permission requests are asynchronous. After a tool call, the engine waits for the connector's decision
before continuing the agent.

```mermaid
sequenceDiagram
  participant Agent
  participant Engine
  participant Connector
  participant User
  Agent->>Engine: request_permission tool call
  Engine->>Connector: requestPermission prompt
  Connector->>User: approval UI
  User->>Connector: allow/deny
  Connector->>Engine: permission decision
  Engine->>Agent: incoming decision message
```
