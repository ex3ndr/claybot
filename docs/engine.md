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
- `GET /v1/engine/sessions`
- `GET /v1/engine/sessions/:storageId`
- `POST /v1/engine/sessions/:storageId/reset`
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
  Tasks -->|batch prompt| HeartbeatSession[Heartbeat session]
  HeartbeatSession -->|single inference call| Provider[Inference provider]
  HeartbeatSession -->|record run per task| Store[Heartbeat state]
  Scheduler --> Events[Event bus]
```

## Session descriptor persistence

Each session writes a type descriptor into the first `session_created` log entry. On startup, the engine restores
that descriptor into session state and uses it to resolve the most recent matching session when needed.
Fetch strategies are limited to `most-recent-foreground` and `heartbeat`.

```mermaid
flowchart TD
  Create[session.created] --> Log[jsonl session_created entry]
  Log -->|session descriptor| Store[SessionStore]
  Store --> Restore[Engine restore]
  Restore --> State[session.state.session]
  Resolver[Session resolver] -->|descriptor| State
  State -->|most recent match| Resolver
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
before continuing the session.

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
