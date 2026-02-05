# Tokens Tracking

ClayBot tracks current token sizes for each agent and aggregates real usage by provider/model. After every inference response, ClayBot records the provider, model, and token sizes on the assistant history entry. If the provider does not return usage data, ClayBot writes an estimated size to the history entry, but **does not** increment stats.

## State + History

- `state.json` includes `tokens` (nullable) with the latest provider/model/size (including `total`) for the current session.
- `state.json` includes `stats` as `{ [provider]: { [model]: { input, output, cacheRead, cacheWrite } } }` from real usage only.
- `history.jsonl` stores token sizes inside each `assistant_message` record under `tokens`.
- Session resets/compactions clear `tokens` but leave `stats` intact.

```mermaid
sequenceDiagram
  participant Agent
  participant Inference
  participant History
  participant State

  Agent->>Inference: complete(context)
  Inference-->>Agent: AssistantMessage (+ usage?)
  Agent->>Agent: resolve usage or estimate
  Agent->>History: append assistant_message (tokens)
  Agent->>State: update tokens + stats
```
