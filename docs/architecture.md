# Architecture

Grambot is a plugin-driven engine that routes connector traffic through sessions, inference, tools, and memory.

Key pieces:
- **CLI** (`sources/main.ts`) starts the engine and manages plugins/auth.
- **Plugins** register connectors and tools.
- **Providers** register inference and image generation capabilities.
- **Auth store** (`.scout/auth.json`) holds provider credentials.
- **File store** persists attachments for connectors and tools.
- **Session manager** serializes handling per session and persists state.
- **Memory plugin** records session updates and supports queries.
- **Cron scheduler** emits timed messages into sessions.
- **Inference router** picks providers from settings.
- **Engine server** exposes a local HTTP socket + SSE for status/events.
- **Dashboard** (`gram-dashboard`) proxies `/api` to the engine socket.

```mermaid
flowchart LR
  CLI[CLI: gram] --> Start[start command]
  Start --> Settings[.scout/settings.json]
  Start --> Auth[.scout/auth.json]
  Start --> Providers[ProviderManager]
  Start --> Plugins[PluginManager]
  Providers --> Inference[InferenceRegistry]
  Providers --> Images[ImageRegistry]
  Plugins --> Connectors[ConnectorRegistry]
  Plugins --> Tools[ToolResolver]
  Connectors -->|message| Sessions[SessionManager]
  Cron[CronScheduler] -->|message| Sessions
  Sessions --> InferenceRouter
  InferenceRouter --> Tools
  Tools --> Connectors
  Sessions --> Memory[Memory plugin]
  Start --> Engine[Engine server]
  Engine --> Dashboard[gram-dashboard /api proxy]
```

## Message lifecycle
1. Connector emits a `ConnectorMessage` (text + files).
2. `SessionManager` routes to a session (provider + user or explicit sessionId).
3. `Engine` builds a LLM context with attachments.
4. Inference runs with tools (cron, memory, web search, image generation).
5. Responses and generated files are sent back through the connector.
6. Session state + memory are updated.
