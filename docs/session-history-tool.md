# Session History Tool

`read_session_history` lets an agent inspect another session's history by `agentId`.

- `agentId`: target agent/session id to read (required)
- `summarized`: when omitted, defaults to `true`
  - `true`: runs a summarization model and returns model-generated summary text
  - `false`: return full JSON history payload
- summarized mode selects the normal-sized model when provider metadata is available

```mermaid
sequenceDiagram
  participant Agent as Calling Agent
  participant Tool as read_session_history
  participant Disk as Agent Store
  participant Router as InferenceRouter
  participant Model as Summarization Model
  Agent->>Tool: agentId + summarized?
  Tool->>Disk: read descriptor.json
  Tool->>Disk: read history.jsonl
  alt summarized=true (default)
    Tool->>Router: complete(summary context)
    Router->>Model: summarize history payload
    Model-->>Router: assistant summary
    Router-->>Tool: summary text
    Tool-->>Agent: model summary + recordCount
  else summarized=false
    Tool-->>Agent: full JSON history + recordCount
  end
```
