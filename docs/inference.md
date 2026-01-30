# Inference runtime

Inference is now a plugin capability. Providers register with the `InferenceRegistry`,
and the `InferenceRouter` selects them based on `.scout/settings.json`.

## Providers
Configured in settings (in priority order):
```json
{
  "inference": {
    "providers": [
      { "id": "openai", "model": "gpt-4o-mini" }
    ]
  }
}
```

`gram add` prompts for a default model during provider onboarding and inserts the provider at the
front of the list so it becomes the primary fallback.

```mermaid
flowchart LR
  CLI[gram add] --> Auth[.scout/auth.json]
  CLI --> Settings[.scout/settings.json]
  Settings --> Inference[InferenceRouter]
  Auth --> Inference
```

## Tools
Tools are registered dynamically by plugins and core runtime:
- `add_cron` schedules a cron task.
- `memory_search` queries the memory plugin.
- `web_search` (Brave) performs web search.
- `generate_image` uses registered image providers.
- `set_reaction` sets connector reactions (Telegram).

```mermaid
sequenceDiagram
  participant Model
  participant Engine
  participant Tool
  Model->>Engine: toolCall
  Engine->>Tool: execute
  Tool-->>Engine: toolResult (+ files)
  Engine-->>Model: toolResult
```

```mermaid
sequenceDiagram
  participant Engine
  participant Settings
  participant Auth
  participant Inference
  participant Tools
  Engine->>Settings: read providers
  Engine->>Auth: read credentials
  Engine->>Inference: complete(context + tools)
  Inference-->>Tools: tool call(s)
  Tools-->>Inference: tool result(s)
```
