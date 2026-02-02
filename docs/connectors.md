# Connectors

Connectors are plugin modules that bridge ClayBot to external systems.
They emit messages (text + files) into agents and send responses back.

## Connector interface
Each connector exposes:
- `onMessage(handler)` to receive `ConnectorMessage` events.
- `sendMessage(targetId, message)` to respond (including files).

Messages are normalized to:
```
{ text: string | null, files?: FileReference[], replyToMessageId?: string }
```

```mermaid
classDiagram
  class Connector {
    <<interface>>
    +onMessage(handler)
    +sendMessage(targetId, message)
  }
  class ConnectorMessage {
    +text: string | null
    +files?: FileReference[]
    +replyToMessageId?: string
  }
  class MessageContext {
    +messageId?: string
  }
```

Connectors emit a user descriptor alongside `MessageContext` for agent targeting.

## Telegram connector
- Implemented as the `telegram` plugin.
- Uses long polling by default.
- Persists `lastUpdateId` to `.claybot/telegram-offset.json`.
- Downloads incoming files into the shared file store.
- Sends images/documents when tool results include files.
- Supports chat actions (typing) and reactions.

```mermaid
flowchart TD
  Start[TelegramConnector] --> Poll[Polling]
  Poll --> Msg[message event]
  Msg --> Files[download files]
  Files --> Store[FileStore]
  Msg --> Track[track update_id]
  Track --> Persist[persist offset]
  Poll -->|error| Retry[backoff + retry]
  Shutdown[SIGINT/SIGTERM] --> Stop[stopPolling]
  Stop --> Persist
```

## Telegram permissions
- Permission prompts render with inline buttons and are edited in-place after a decision.

```mermaid
sequenceDiagram
  participant U as User
  participant T as TelegramConnector
  participant B as Telegram API
  U->>T: request_permission tool
  T->>B: sendMessage (inline keyboard)
  U->>B: tap Allow/Deny
  B->>T: callback_query
  T->>B: editMessageText (status)
```
