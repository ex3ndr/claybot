# Configuration

Scout now reads from a single settings file plus the secrets store.

- `.scout/settings.json` (or the path passed to `scout start --settings`)
- `.scout/secrets.json` for plugin secrets

```mermaid
flowchart TD
  Start[scout start] --> Settings[.scout/settings.json]
  Start --> Secrets[.scout/secrets.json]
  Settings --> Plugins
  Settings --> Inference
  Settings --> Cron
  Settings --> Runtime
```

## Sample `.scout/settings.json`
```json
{
  "engine": {
    "socketPath": ".scout/scout.sock",
    "dataDir": ".scout"
  },
  "plugins": [
    { "id": "telegram", "enabled": true, "config": { "polling": true } },
    { "id": "brave-search", "enabled": true },
    { "id": "gpt-image", "enabled": true },
    { "id": "nanobanana", "enabled": false, "config": { "endpoint": "https://api.example.com/images" } },
    { "id": "openai-codex", "enabled": true },
    { "id": "anthropic", "enabled": true }
  ],
  "inference": {
    "providers": [
      { "id": "openai-codex", "model": "gpt-5.1-codex-mini" },
      { "id": "anthropic", "model": "claude-3-7-sonnet-latest" }
    ]
  },
  "cron": {
    "tasks": [
      {
        "id": "heartbeat",
        "everyMs": 60000,
        "message": "ping",
        "action": "send-message",
        "runOnStart": true,
        "channelId": "local",
        "source": "telegram"
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
      "connection": { "socketPath": "/var/run/docker.sock" },
      "containers": [{ "name": "redis", "action": "ensure-running" }]
    }
  },
  "memory": {
    "enabled": true,
    "maxEntries": 1000
  },
  "assistant": {
    "workspaceDir": "/Users/you/workspace/scout-project",
    "containerWorkspacePath": "/workspace",
    "allowedDockerImages": ["node:22-alpine", "python:3.12-slim"],
    "allowedPm2Processes": ["worker", "api"]
  }
}
```

## `.scout/secrets.json`
Secrets are stored per plugin id:

```json
{
  "version": 1,
  "secrets": {
    "telegram": { "token": "..." },
    "brave-search": { "apiKey": "..." },
    "openai-codex": { "apiKey": "..." },
    "anthropic": { "apiKey": "..." },
    "gpt-image": { "apiKey": "..." },
    "nanobanana": { "apiKey": "..." }
  }
}
```
