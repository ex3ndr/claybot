<p align="center">
  <img src="logo.png" alt="Daycare" width="200" />
</p>

<h1 align="center">Daycare</h1>

<p align="center">
  A minimal, composable AI agent framework with plugin-driven architecture.
</p>

## Features

- **Plugin system** - Connectors, inference providers, tools, and image generators as plugins
- **Agent management** - Per-channel message sequencing with persistent state
- **Memory plugin** - Searchable conversation history across agents
- **Cron scheduler** - Timed message dispatch and scheduled actions
- **Multi-provider inference** - Anthropic, OpenAI, Google Gemini, Groq, Mistral, xAI, and more
- **Heartbeat scheduler** - Periodic agent actions on configurable intervals
- **Skills** - Composable agent skills for scheduling, agent creation, and more
- **Dashboard** - Next.js app for monitoring and control

## Quick Start

```sh
# Install dependencies
yarn install

# Build the project
yarn build

# Start the engine
yarn daycare start
```

## Configuration

Daycare uses two configuration files in `.daycare/`:

**settings.json** - Engine and plugin configuration
```json
{
  "engine": { "socketPath": ".daycare/daycare.sock", "dataDir": ".daycare" },
  "plugins": [
    { "instanceId": "telegram", "pluginId": "telegram", "enabled": true },
    { "instanceId": "anthropic", "pluginId": "anthropic", "enabled": true },
    { "instanceId": "memory", "pluginId": "memory", "enabled": true }
  ],
  "inference": {
    "providers": [{ "id": "anthropic", "model": "claude-sonnet-4-20250514" }]
  }
}
```

**auth.json** - API keys and tokens
```json
{
  "telegram": { "type": "token", "token": "..." },
  "openai": { "type": "apiKey", "apiKey": "..." }
}
```

## Plugins

| Plugin | Type | Description |
|--------|------|-------------|
| telegram | Connector | Telegram bot with long polling |
| whatsapp | Connector | WhatsApp via Baileys with QR auth |
| anthropic-fetch | Web Fetch | URL content extraction via Claude |
| anthropic-search | Web Search | Search powered by Claude |
| brave-search | Web Search | Brave Search API integration |
| exa-ai | Web Search | Neural search via Exa AI |
| firecrawl | Web Fetch | Clean content extraction via Firecrawl |
| gemini-search | Web Search | Google Gemini with Search Grounding |
| openai-search | Web Search | GPT-powered web search |
| perplexity-search | Web Search | Perplexity Sonar search |
| web-fetch | Web Fetch | Minimal URL content download |
| memory | System | Structured entity storage as Markdown |
| database | System | Local PGlite (Postgres) with schema docs |
| shell | Tool | File read/write/edit and command execution |
| monty-python | Tool | Sandboxed Python snippets via Monty |

## Tools

Built-in tools available to the agent:

- `cron_add` / `cron_read_task` / `cron_read_memory` / `cron_write_memory` / `cron_delete_task` - Cron scheduling
- `heartbeat_add` / `heartbeat_run` / `heartbeat_list` / `heartbeat_remove` - Heartbeat scheduling
- `create_permanent_agent` / `start_background_agent` / `send_agent_message` - Multi-agent coordination
- `generate_image` - Image generation via configured providers
- `generate_mermaid_png` - Render Mermaid source into a PNG artifact
- `set_reaction` - React to messages
- `send_file` - Send files via connectors
- `request_permission` / `grant_permission` - Runtime permission management

Plugin-provided tools:

- `read` / `write` / `edit` / `exec` - File system and shell (shell plugin)
- `python` - Sandboxed Python execution (monty-python plugin)
- `memory_create_entity` / `memory_upsert_record` / `memory_list_entities` - Entity memory (memory plugin)
- Web search / fetch tools from search and fetch plugins

## CLI Commands

```sh
daycare start                              # Launch the engine
daycare status                             # Check engine status
daycare add                                # Add a provider or plugin
daycare remove                             # Remove a provider or plugin
daycare providers                          # Select default provider
daycare plugins load <pluginId>            # Load a plugin
daycare plugins unload <instanceId>        # Unload a plugin
daycare auth set <id> <key> <value>        # Store a credential
daycare doctor                             # Run inference health checks
```

## Development

```sh
yarn install      # Install dependencies
yarn build        # Compile TypeScript
yarn test         # Run tests
yarn typecheck    # Type check without emit
yarn dev          # Run with tsx (no build)
```

## Workspace

- `packages/daycare` - Core engine, plugins, and tools
- `packages/daycare-dashboard` - Next.js dashboard

## Documentation

See [docs/](./docs/) for detailed documentation:

- [Architecture](./docs/architecture.md) - System overview
- [Plugins](./docs/plugins.md) - Plugin system
- [Agents](./docs/agents.md) - Agent management and queueing
- [Agent System](./docs/agent-system.md) - Agent lifecycle and ownership
- [Memory](./docs/memory.md) - Memory plugin
- [Cron](./docs/cron.md) - Scheduled tasks
- [Heartbeat](./docs/heartbeat.md) - Heartbeat scheduler
- [Skills](./docs/skills.md) - Agent skills
- [Config](./docs/config.md) - Configuration reference
- [Permissions](./docs/permissions.md) - Permission system
- [CLI](./docs/cli.md) - Command reference
- [Inference](./docs/inference.md) - Inference providers
- [Mermaid PNG Tool](./docs/mermaid-png-tool.md) - Built-in tool for rendering Mermaid diagrams

## License

MIT
