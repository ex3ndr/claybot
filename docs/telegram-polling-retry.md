# Telegram polling retry

This note documents how the Telegram connector handles polling errors and conflicts.

```mermaid
flowchart TD
  A[Polling error] --> B{Conflict 409?}
  B -- yes --> C{Webhook cleared?}
  C -- no --> D[Clear webhook]
  C -- yes --> E[Log + rely on library restart]
  B -- no --> F[Log + rely on library restart]
```

## Notes
- Polling restarts are handled by the Telegram library (`restart: true`).
- The connector clears the webhook once when it encounters a 409 conflict.
- `startPolling` is guarded to avoid concurrent start attempts while a previous start is still in flight.
