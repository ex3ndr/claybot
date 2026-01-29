# CLI

The CLI is implemented with Commander in `sources/main.ts`. It always initializes logging first.

## Commands
- `start` - launches configured connectors and attaches the echo handler.
- `status` - placeholder status command.
- `add telegram` - prompts for a bot token and writes `.scout/auth.json`.
- `add codex` - prompts for a Codex token + model id and appends to inference providers.
- `add claude` - prompts for a Claude Code token + model id and appends to inference providers.

### `add` options
- `--model <id>` sets the model id without prompting.
- `--main` marks the provider as primary (moves it to the front of the priority list).

## Development
- `yarn dev` runs the CLI directly via `tsx`.

```mermaid
flowchart TD
  main[main.ts] --> start[start]
  main --> status[status]
  main --> add[add]
  add --> telegram[telegram]
```

## start command flow
```mermaid
sequenceDiagram
  participant User
  participant CLI
  participant Config
  participant Cron
  participant PM2
  participant Auth
  participant Connector
  participant Sessions
  User->>CLI: scout start
  CLI->>Config: load scout.config.json
  CLI->>Auth: read .scout/auth.json
  CLI->>Config: read .scout/telegram.json (legacy)
  CLI->>Connector: init connectors
  CLI->>Cron: init cron tasks (optional)
  CLI->>PM2: start pm2 processes (optional)
  Connector->>Sessions: onMessage
  Sessions->>Connector: sendMessage (echo)
```
