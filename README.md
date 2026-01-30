# grambot

A minimal, composable AI agent framework with plugin-driven architecture.

## Features

- **Plugin system** - Connectors, inference providers, tools, and image generators as plugins
- **Session management** - Per-channel message sequencing with persistent state
- **Memory engine** - Searchable conversation history across sessions
- **Cron scheduler** - Timed message dispatch and scheduled actions
- **Multi-provider inference** - Anthropic Claude, OpenAI, and more
- **Dashboard** - React SPA for monitoring and control

## Architecture

```mermaid
flowchart LR
  CLI[gram CLI] --> Engine[Engine Runtime]
  Engine --> Plugins[Plugin Manager]
  Plugins --> Connectors[Connectors]
  Plugins --> Inference[Inference Providers]
  Plugins --> Tools[Tool Registry]
  Connectors -->|message| Sessions[Session Manager]
  Cron[Cron Scheduler] -->|message| Sessions
  Sessions --> InferenceRouter[Inference Router]
  InferenceRouter --> Tools
  Sessions --> Memory[Memory Engine]
  Engine --> Socket[HTTP Socket API]
  Socket --> Dashboard[gram-dashboard]
```

## Quick Start

```sh
# Install dependencies
yarn install

# Build the project
yarn build

# Start the engine
yarn gram start
```

## Configuration

Grambot uses two configuration files in `.scout/`:

**settings.json** - Engine and plugin configuration
```json
{
  "engine": { "socketPath": ".scout/scout.sock", "dataDir": ".scout" },
  "plugins": [
    { "id": "telegram", "enabled": true },
    { "id": "anthropic", "enabled": true }
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

## Tools

The AI agent has access to these tools:

- `add_cron` - Schedule recurring tasks
- `memory_search` - Query conversation history
- `web_search` - Search the web (Brave)
- `generate_image` - Create images
- `set_reaction` - React to messages

## CLI Commands

```sh
gram start                    # Launch the engine
gram status                   # Check engine status
gram add                      # Add an inference provider
gram plugins load <id>        # Load a plugin
gram plugins unload <id>      # Unload a plugin
gram auth set <id> <key> <value>         # Store a credential
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

- `packages/gram` - Core engine, plugins, and tools
- `packages/gram-dashboard` - React dashboard + API proxy

## Documentation

See [docs/](./docs/) for detailed documentation:

- [Architecture](./docs/architecture.md) - System overview
- [Plugins](./docs/plugins.md) - Plugin system
- [Sessions](./docs/sessions.md) - Session management
- [Memory](./docs/memory.md) - Memory engine
- [Cron](./docs/cron.md) - Scheduled tasks
- [Config](./docs/config.md) - Configuration reference
- [CLI](./docs/cli.md) - Command reference

## License

MIT
