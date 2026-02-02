# Architecture

ClayBot is a plugin-driven engine that routes connector traffic through agents, inference, tools, and memory.

Key pieces:
- **CLI** (`sources/main.ts`) starts the engine and manages plugins/auth.
- **Plugins** register connectors and tools.
- **Providers** register inference and image generation capabilities.
- **Auth store** (`.claybot/auth.json`) holds provider credentials.
- **File store** persists attachments for connectors and tools.
- **Agent system** routes messages into per-agent inboxes and persists state.
- **Memory plugin** records agent updates and supports queries.
- **Cron scheduler** emits timed messages into agents.
- **Inference router** picks providers from settings.
- **Engine server** exposes a local HTTP socket + SSE for status/events.
- **Dashboard** (`claybot-dashboard`) proxies `/api` to the engine socket.

```mermaid
flowchart LR
  CLI[CLI: claybot] --> Start[start command]
  Start --> Settings[.claybot/settings.json]
  Start --> Auth[.claybot/auth.json]
  Start --> Providers[ProviderManager]
  Start --> Plugins[PluginManager]
  Providers --> Inference[InferenceRegistry]
  Providers --> Images[ImageRegistry]
  Plugins --> Connectors[ConnectorRegistry]
  Plugins --> Tools[ToolResolver]
  Connectors -->|message| AgentSystem[AgentSystem]
  Cron[CronScheduler] -->|message| AgentSystem
  AgentSystem --> Inbox[AgentInbox]
  Inbox --> Agent
  Agent --> InferenceRouter
  InferenceRouter --> Tools
  Tools --> Connectors
  Agent --> Memory[Memory plugin]
  Start --> Engine[Engine server]
  Engine --> Dashboard[claybot-dashboard /api proxy]
```

## Message lifecycle
1. Connector emits a `ConnectorMessage` (text + files).
2. `AgentSystem` routes to an agent and enqueues work in the agent inbox.
3. `Engine` builds a LLM context with attachments.
4. Inference runs with tools (cron, memory, web search, image generation).
5. Responses and generated files are sent back through the connector.
6. Agent state + memory are updated.
