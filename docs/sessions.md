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
- Session ids are cuid2 values mapped to `connector + channelId + userId`.
- Connectors must provide `channelId` and `userId` for mapping.
- A connector or scheduler can override with `context.sessionId`.
- Messages (and files) are queued and processed in order.

## System message routing
When `send_session_message` omits a target session id, the engine routes to the most recent
foreground user session.

```mermaid
sequenceDiagram
  participant Subagent
  participant Engine
  participant SessionStore
  participant Connector
  Subagent->>Engine: send_session_message(text)
  Engine->>SessionStore: listSessions()
  SessionStore-->>Engine: sessions
  Engine->>Engine: pick most recent foreground
  Engine->>Connector: sendMessage(<system_message>)
```

## Session persistence
- Sessions are written to `.claybot/sessions/<cuid2>.jsonl` as append-only logs.
- Entries include `session_created`, `model_context`, `outgoing`, `session_reset`, `session_compaction`, and `state` snapshots.
- `model_context` records the raw messages sent to the inference model.
- `incoming` entries store the full incoming text and files (excluding system_message inputs).
- `outgoing` entries store the user-facing reply and files (origin is tagged as `model` or `system`).

## Model context logging
```mermaid
sequenceDiagram
  participant Engine
  participant SessionStore
  participant Inference
  Engine->>SessionStore: record_model_context(messages, systemPrompt)
  Engine->>Inference: complete(context)
  Inference-->>Engine: assistant response
  Engine->>SessionStore: record_outgoing(text/files, origin="model")
```

## Context serialization
Context messages are serialized for logging and restored without loss.

```mermaid
flowchart LR
  InMemory[Context.messages]
  Serialize[serializeContextMessages]
  Logged[model_context.messages]
  Restore[restoreContextMessages]
  Recovered[Context.messages]
  InMemory --> Serialize --> Logged --> Restore --> Recovered
```

## Subagent failure notifications
Background sessions emit a single failure notification to the parent session.

```mermaid
sequenceDiagram
  participant Subagent
  participant Engine
  participant ParentSession
  Subagent-->>Engine: error or tool limit
  Engine->>ParentSession: send_session_message(failure)
```

## Background agent start
Starting a subagent enqueues work and returns immediately; the background session continues processing asynchronously.

```mermaid
sequenceDiagram
  participant Foreground
  participant Engine
  participant SessionManager
  participant Subagent
  Foreground->>Engine: start_background_agent(prompt)
  Engine->>SessionManager: enqueue(message)
  Engine-->>Foreground: tool result (session id)
  SessionManager->>Subagent: process queue
```

## Resetting sessions
- Sessions can be reset without changing the session id.
- Reset clears the stored context messages but keeps the provider binding intact.
- Connectors are responsible for handling reset/compaction commands; the engine does not interpret slash commands.

## Key types
- `SessionMessage` stores message, context, and timestamps.
- `SessionContext` holds mutable per-session state.
- `FileReference` links attachments in the file store.
