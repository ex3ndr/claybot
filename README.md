<p align="center">
  <img src="logo.png" alt="ClayBot" width="200" />
</p>

<h1 align="center">ClayBot</h1>

<p align="center">
  A minimal, composable AI agent framework with plugin-driven architecture.
</p>

## Features

- **Plugin system** - Connectors, inference providers, tools, and image generators as plugins
- **Agent management** - Per-channel message sequencing with persistent state
- **Memory plugin** - Searchable conversation history across agents
- **Cron scheduler** - Timed message dispatch and scheduled actions
- **Multi-provider inference** - Anthropic Claude, OpenAI, and more
- **Dashboard** - React SPA for monitoring and control

## Architecture

```mermaid
flowchart LR
  CLI[claybot CLI] --> Engine[Engine]
  Engine --> Plugins[Plugin Manager]
  Plugins --> Connectors[Connectors]
  Plugins --> Inference[Inference Providers]
  Plugins --> Tools[Tool Resolver]
  Connectors -->|message| Agents[Agent System]
  Cron[Cron Scheduler] -->|message| Agents
  Agents --> InferenceRouter[Inference Router]
  InferenceRouter --> Tools
  Agents --> Memory[Memory Plugin]
  Engine --> Socket[HTTP Socket API]
  Socket --> Dashboard[claybot-dashboard]
```

## Quick Start

```sh
# Install dependencies
yarn install

# Build the project
yarn build

# Start the engine
yarn claybot start
```

## Configuration

ClayBot uses two configuration files in `.claybot/`:

**settings.json** - Engine and plugin configuration
```json
{
  "engine": { "socketPath": ".claybot/claybot.sock", "dataDir": ".claybot" },
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
| openai | Inference | GPT models via OpenAI API |
| brave-search | Tool | Web search integration |
| gpt-image | Image | OpenAI image generation |
| nanobanana | Image | Alternative image provider |
| memory | Tool | Conversation memory and search |

## Tools

The AI agent has access to these tools:

- `add_cron` - Schedule recurring tasks
- `cron_read_task` - Read cron task description + prompt
- `cron_read_memory` - Read cron task memory
- `cron_write_memory` - Update cron task memory
- `cron_delete_task` - Delete a cron task
- `memory_search` - Query conversation history (memory plugin)
- `web_search` - Search the web (Brave)
- `generate_image` - Create images
- `set_reaction` - React to messages

## CLI Commands

```sh
claybot start                    # Launch the engine
claybot status                   # Check engine status
claybot add                      # Add a provider or plugin
claybot plugins load <id>        # Load a plugin
claybot plugins unload <id>      # Unload a plugin
claybot auth set <id> <key> <value>         # Store a credential
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

- `packages/claybot` - Core engine, plugins, and tools
- `packages/claybot-dashboard` - React dashboard + API proxy

## Documentation

See [docs/](./docs/) for detailed documentation:

- [Architecture](./docs/architecture.md) - System overview
- [Plugins](./docs/plugins.md) - Plugin system
- [Agents](./docs/agents.md) - Agent management
- [Memory](./docs/memory.md) - Memory plugin
- [Cron](./docs/cron.md) - Scheduled tasks
- [Config](./docs/config.md) - Configuration reference
- [CLI](./docs/cli.md) - Command reference

## License

MIT
