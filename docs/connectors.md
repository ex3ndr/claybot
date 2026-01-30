# Connectors

Connectors are plugin modules that bridge Grambot to external systems.
They emit messages (text + files) into sessions and send responses back.

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
    +channelId: string
    +userId: string | null
    +sessionId?: string
    +messageId?: string
    +providerId?: string
  }
```

## Telegram connector
- Implemented as the `telegram` plugin.
- Uses long polling by default.
- Persists `lastUpdateId` to `.scout/telegram-offset.json`.
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
