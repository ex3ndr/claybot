# Connectors

Connectors are plugin modules that bridge Daycare to external systems.
They emit messages (text + files) into agents and send responses back.

## Connector interface
Each connector exposes:
- `onMessage(handler)` to receive `ConnectorMessage` events.
- `onCommand(handler)` to receive command text events.
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
    +onCommand(handler)
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
- Persists `lastUpdateId` to `.daycare/telegram-offset.json`.
- Downloads incoming files into the shared file store.
- Sends images/documents when tool results include files.
- Supports chat actions (typing) and reactions.
- Outgoing text uses MarkdownV2 parse mode.

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

## Telegram message formatting
- Connector prompts the model to follow MarkdownV2 rules.
- Permission prompts are formatted with MarkdownV2-safe escaping.
- If Telegram rejects a message due to parsing, the connector retries without `parse_mode`.

```mermaid
flowchart LR
  Prompt[messageFormatPrompt] --> Model[assistant response]
  Model --> Format[MarkdownV2 formatting + escaping]
  Format --> Send[TelegramConnector.sendMessage]
  Send --> API[Telegram API parse_mode=MarkdownV2]
  API -->|parse error| Fallback[retry without parse_mode]
```

## Telegram commands
- `/reset` clears the agent message history for the current user.
- `/stop` aborts the current inference for the current user.

```mermaid
sequenceDiagram
  participant U as User
  participant T as TelegramConnector
  participant E as Engine
  participant AS as AgentSystem
  U->>T: /reset
  T->>E: onCommand("/reset")
  E->>AS: post(reset)
```

## Telegram permissions
- Permission prompts render with inline buttons and are edited in-place after a decision.
- Background agents call `request_permission`, but Telegram still receives the same
  `requestPermission` call from the engine (routed via the most recent foreground agent).

```mermaid
sequenceDiagram
  participant A as Agent
  participant E as Engine
  participant T as TelegramConnector
  participant B as Telegram API
  participant U as User
  A->>E: request_permission(_via_parent)
  E->>T: requestPermission
  T->>B: sendMessage (inline keyboard)
  U->>B: tap Allow/Deny
  B->>T: callback_query
  T->>B: editMessageText (status)
  T->>E: onPermission (decision)
```
