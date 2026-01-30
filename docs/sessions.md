# Sessions

Sessions provide per-channel sequencing of messages, ensuring each session is handled one message at a time.

```mermaid
sequenceDiagram
  participant Connector
  participant SessionManager
  participant Session
  participant Engine
  Connector->>SessionManager: handleMessage(source, message, context)
  SessionManager->>Session: enqueue(message)
  SessionManager->>Engine: process queue sequentially
  Engine-->>SessionManager: done
```

## Session rules
- Session id defaults to `${providerId}:${userId}` (falls back to `channelId` when `userId` is missing).
- A connector or scheduler can override with `context.sessionId`.
- Each session is bound to a single provider id and keeps context per provider.
- Messages (and files) are queued and processed in order.

## Session persistence
- Sessions are written to `.scout/sessions/<cuid2>.jsonl` as append-only logs.
- Entries include `session_created`, `incoming`, `outgoing`, and `state` snapshots.
- `incoming`/`outgoing` entries now store `files` when present.

## Resetting sessions
- Sessions can be reset without changing the session id.
- Reset clears the stored context messages but keeps the provider binding intact.

## Memory integration
Session updates are mirrored into the memory plugin (if enabled).

```mermaid
flowchart TD
  Incoming[Session incoming] --> Store[SessionStore]
  Incoming --> Memory[Memory plugin]
  Outgoing[Session outgoing] --> Store
  Outgoing --> Memory
```

## Key types
- `SessionMessage` stores message, context, and timestamps.
- `SessionContext` holds mutable per-session state.
- `FileReference` links attachments in the file store.
