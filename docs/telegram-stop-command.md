# Telegram stop command

This note documents the `/stop` command flow for aborting an in-flight inference.

```mermaid
sequenceDiagram
  participant U as User
  participant T as TelegramConnector
  participant E as Engine
  participant AS as AgentSystem
  participant A as Agent
  participant IR as InferenceRouter

  U->>T: /stop
  T->>E: onCommand("/stop", context, descriptor)
  E->>AS: abortInferenceForTarget(descriptor)
  AS->>A: abortInference()
  A->>IR: complete(..., signal)
  Note over A,IR: AbortSignal is triggered
  E->>T: sendMessage("Stopped current inference.")
```

- If no active inference exists for the target agent, the engine responds with `No active inference to stop.`.
- Aborted inference exits without sending the generic `Inference failed.` fallback message.
