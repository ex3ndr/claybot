# Telegram reset command confirmation

This note documents the `/reset` command flow when received from Telegram.

```mermaid
sequenceDiagram
  participant U as Telegram user
  participant T as Telegram connector
  participant E as Engine
  participant A as AgentSystem

  U->>T: /reset
  T->>E: onCommand("/reset", context, descriptor)
  E->>A: post({ type: "reset" })
  A-->>E: reset applied
  E->>T: sendMessage("Session reset.", replyToMessageId)
  T-->>U: Session reset.
```

## Notes
- The reset command still clears session context with the same reset message payload.
- After reset is posted, Engine sends a direct connector response: `Session reset.`.
- The response keeps conversational threading by setting `replyToMessageId` from command context.
