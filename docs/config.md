# Configuration

Scout reads config in two places when starting:
1. `scout.config.json` (or the path passed to `scout start --config`).
2. `.scout/auth.json` for connector/inference tokens.
3. `.scout/telegram.json` as a legacy fallback for Telegram tokens.

```mermaid
flowchart TD
  Start[scout start] --> ConfigFile[scout.config.json]
  Start --> Auth[.scout/auth.json]
  ConfigFile -->|telegram missing| Fallback[.scout/telegram.json]
  ConfigFile --> Connectors
  Auth --> Connectors
  Fallback --> Connectors
```

## Sample `scout.config.json`
```json
{
  "connectors": {
    "telegram": {
      "token": "...",
      "polling": true,
      "statePath": ".scout/telegram-offset.json",
      "retry": {
        "minDelayMs": 1000,
        "maxDelayMs": 30000,
        "factor": 2,
        "jitter": 0.2
      }
    },
    "chron": {
      "tasks": [
        {
          "id": "heartbeat",
          "everyMs": 60000,
          "message": "ping",
          "runOnStart": true,
          "channelId": "local"
        }
      ]
    }
  },
  "cron": {
    "tasks": [
      {
        "id": "heartbeat",
        "everyMs": 60000,
        "message": "ping",
        "runOnStart": true,
        "channelId": "local"
      }
    ]
  },
  "runtime": {
    "pm2": {
      "processes": [
        {
          "name": "worker",
          "script": "dist/worker.js",
          "args": ["--mode", "job"],
          "autorestart": true
        }
      ]
    },
    "containers": {
      "connection": {
        "socketPath": "/var/run/docker.sock"
      },
      "containers": [
        {
          "name": "redis",
          "action": "ensure-running"
        }
      ]
    }
  }
}
```

Notes:
- `cron` is the preferred top-level config for scheduled tasks.
- `connectors.chron` is still accepted for backward compatibility and will warn.
- `runtime.pm2` configures PM2-managed processes.
- `runtime.containers` manages Docker containers via the Engine API.
- Inference provider priority is stored in `.scout/auth.json`.

## `.scout/auth.json`
Written by `scout add telegram`, `scout add codex`, and `scout add claude`.

```json
{
  "telegram": { "token": "..." },
  "codex": { "token": "..." },
  "claude-code": { "token": "..." },
  "inference": {
    "providers": [
      { "id": "codex", "model": "gpt-5.1-codex-mini", "main": true },
      { "id": "claude-code", "model": "claude-3-7-sonnet-latest" }
    ]
  }
}
```

Provider priority comes from the array order (last entry is lowest priority).
Setting `main: true` moves the provider to the front and clears `main` on others.

## `.scout/telegram.json` (legacy)
Still read if no telegram token is found in `.scout/auth.json`.
```json
{ "token": "..." }
```
