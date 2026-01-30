# Configuration

Grambot now reads from a single settings file plus the auth store.

- `.scout/settings.json` (or the path passed to `gram start --settings`)
- `.scout/auth.json` for credentials

```mermaid
flowchart TD
  Start[gram start] --> Settings[.scout/settings.json]
  Start --> Auth[.scout/auth.json]
  Settings --> Plugins
  Settings --> Inference
  Settings --> Cron
```

## Sample `.scout/settings.json`
```json
{
  "engine": {
    "socketPath": ".scout/scout.sock",
    "dataDir": ".scout"
  },
  "plugins": [
    { "instanceId": "telegram", "pluginId": "telegram", "enabled": true, "settings": { "polling": true } },
    { "instanceId": "brave-search", "pluginId": "brave-search", "enabled": true },
    { "instanceId": "memory", "pluginId": "memory", "enabled": true }
  ],
  "providers": [
    { "id": "openai", "enabled": true, "model": "gpt-4o-mini" },
    { "id": "nanobanana", "enabled": false, "image": { "endpoint": "https://api.example.com/images" } }
  ],
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
  "memory": {
    "enabled": true,
    "maxEntries": 1000
  }
}
```

`memory` settings are consumed by the memory plugin (if enabled). Providers are configured
at the top level; order defines inference priority and `enabled: false` disables a provider.

## `.scout/auth.json`
Credentials are stored per plugin or provider id:

```json
{
  "telegram": { "type": "token", "token": "..." },
  "brave-search": { "type": "apiKey", "apiKey": "..." },
  "openai": { "type": "apiKey", "apiKey": "..." },
  "anthropic": { "type": "apiKey", "apiKey": "..." },
  "nanobanana": { "type": "apiKey", "apiKey": "..." }
}
```
