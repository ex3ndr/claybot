# Auth Store

Grambot stores credentials in `.scout/auth.json`.
The file is read by the engine on startup and on demand by plugins.

## Structure
```json
{
  "telegram": { "type": "token", "token": "..." },
  "brave-search": { "type": "apiKey", "apiKey": "..." },
  "openai": { "type": "apiKey", "apiKey": "..." },
  "anthropic": { "type": "oauth", "refreshToken": "...", "accessToken": "..." },
  "gpt-image": { "type": "apiKey", "apiKey": "..." },
  "nanobanana": { "type": "apiKey", "apiKey": "..." }
}
```

Auth entries are keyed by the identifier used by the plugin. Provider plugins use the provider id
(the same value as `pluginId`), even when the instance id is random.

## CLI helpers
- `gram auth set <id> <key> <value>` updates the auth store.

```mermaid
flowchart TD
  CLI[gram auth set] --> Auth[.scout/auth.json]
  Auth --> Plugins
```

## Usage
- Connectors read auth for tokens (e.g., Telegram).
- Inference providers read auth for API keys or OAuth credentials.
- Tool plugins read auth for external services.
