# Agents

Agents provide per-channel sequencing of messages, ensuring each agent is handled one message at a time.

```mermaid
sequenceDiagram
  participant Connector
  participant AgentSystem
  participant AgentInbox
  participant Agent
  Connector->>AgentSystem: post message
  AgentSystem->>AgentInbox: enqueue(message)
  AgentInbox->>Agent: next()
  Agent-->>AgentInbox: done
```

## Agent identity rules
- Agent ids are cuid2 values mapped to user descriptors (`connector + channelId + userId`), cron task uid, or system-agent tags (for example `heartbeat`).
- Connectors provide user descriptors for mapping; `MessageContext` only carries message-level metadata.
- Messages (and files) are queued and processed in order via `AgentInbox`.

## Message source resolution
Inbox items store message content and context only; the connector source is resolved from the
agent descriptor when handling a message.

```mermaid
flowchart LR
  Inbox[AgentInboxItem] --> Agent[Agent.handleMessage]
  Agent --> Descriptor[descriptor.connector]
  Descriptor --> Connector[connectorRegistry.get]
```

## System message delivery
`send_agent_message` posts a `system_message` inbox item. The agent wraps the text
as a `<system_message>` tag before running the inference loop. When a target agent id
is omitted, the tool resolves the most recent foreground agent.

```mermaid
flowchart LR
  SendTool[send_agent_message] --> Post[agentSystem.post(system_message)]
  Post --> Agent[Agent.handleSystemMessage]
  Agent --> Wrap[messageBuildSystemText]
```

```mermaid
sequenceDiagram
  participant Subagent
  participant AgentSystem
  participant Agent
  Subagent->>AgentSystem: agentFor("most-recent-foreground")
  AgentSystem-->>Subagent: agentId
  Subagent->>AgentSystem: post(system_message)
  AgentSystem->>Agent: handleSystemMessage
```

## System message format
Agents wrap system message text in a `<system_message>` tag with an origin attribute set to the
sender’s agent id so they can distinguish internal updates from user input.

```mermaid
flowchart LR
  SystemItem[system_message item] --> Build[messageBuildSystemText]
  Build --> Wrapped["<system_message origin='<agentId>'>text</system_message>"]
  Wrapped --> Inbox[AgentInbox]
```

## System message persistence
System messages are treated like normal incoming messages. They are recorded in
`history.jsonl` and included in the rebuilt runtime context so agents can see
them and logs show the full flow.

```mermaid
flowchart LR
  Wrapped["<system_message ...>"] --> Inbox[AgentInbox]
  Inbox --> History[history.jsonl user_message]
  History --> Context[buildHistoryContext]
  Context --> Inference[agent loop]
```

## Silent system messages
Silent system messages are recorded in history and added to the runtime context,
but they do not trigger an inference step.

```mermaid
flowchart LR
  Silent[system_message silent=true] --> Append[history.jsonl user_message]
  Append --> Context[agent.state.context]
  Context --> Next[used on next inference]
```

## Image token estimation
Image payloads are treated as non-text during token estimation. Inline image data is
sanitized to a `"<image>"` placeholder so token counts do not scale with base64 size.

```mermaid
flowchart LR
  Image[image content/data] --> Sanitize[replace data with "<image>"]
  Sanitize --> Estimate[estimate symbols/tokens]
```

## Permission request forwarding
Background agents use `request_permission`. The engine shows the request to the user and also
notifies the most recent foreground agent via silent system messages (request presented + decision).

```mermaid
sequenceDiagram
  participant Background as Background Agent
  participant AgentSystem
  participant Foreground as Foreground Agent
  participant Connector
  participant User
  Background->>AgentSystem: request_permission
  AgentSystem->>Connector: requestPermission (prompt user)
  Connector->>User: approval UI
  AgentSystem->>Foreground: system_message (request presented)
  User-->>Connector: decision
  Connector->>AgentSystem: permission decision
  AgentSystem->>Background: permission decision
  AgentSystem->>Foreground: system_message (decision)
```

## Tool loop exhaustion warnings
Tool execution limit notices are only emitted when the last response actually contained tool calls.

```mermaid
flowchart LR
  Response[assistant response] --> Exceeded{tool loop exceeded?}
  Exceeded -->|no| Done[no warning]
  Exceeded -->|yes| ToolCalls{last response had tool calls?}
  ToolCalls -->|yes| Notify[send tool limit warning]
  ToolCalls -->|no| Done
```

## Agent persistence
- Agents are written to `.daycare/agents/<cuid2>/` as discrete files.
- `descriptor.json` captures the agent type and identity.
- `state.json` stores provider selection, permissions, and timestamps.
- `history.jsonl` stores minimal user/assistant/tool records.
- History is restored starting after the most recent `start` or `reset` marker.

## Model context reconstruction
History records are expanded into inference context on restore.

```mermaid
flowchart LR
  History[history.jsonl] --> Build[agent.buildHistoryContext]
  Build --> Context[Context.messages]
```

## Emergency context pruning
The agent estimates context size from history and compares it to the emergency limit
(`settings.agents.emergencyContextLimit`, default 200000).

```mermaid
flowchart LR
  History[history.jsonl] --> Estimate[contextEstimateTokens]
  Estimate --> Compare[contextNeedsEmergencyReset]
  Compare -->|>= limit| Reset[reset agent]
  Compare -->|< limit| Keep[keep context]
```

## Subagent failure notifications
Background agents post a single failure notification to the parent agent.

```mermaid
sequenceDiagram
  participant Subagent
  participant AgentSystem
  participant ParentAgent
  Subagent-->>AgentSystem: post(system failure message)
  AgentSystem->>ParentAgent: enqueue message
```

## Background agent start
Starting a subagent posts the first message and returns immediately; each call creates a new background agent.

```mermaid
sequenceDiagram
  participant Foreground
  participant AgentSystem
  participant Subagent
  Foreground->>AgentSystem: post(subagent message)
  AgentSystem->>Subagent: enqueue message
  Foreground-->>Foreground: tool result (new agent id)
```

## Background agent reporting
Foreground prompts should instruct subagents to report progress via `send_agent_message`.

```mermaid
sequenceDiagram
  participant Foreground
  participant AgentSystem
  participant Subagent
  Foreground->>AgentSystem: start_background_agent(prompt + report back)
  AgentSystem->>Subagent: enqueue prompt
  Subagent->>AgentSystem: send_agent_message(status update)
  AgentSystem->>Foreground: enqueue system_message
```

## Resetting agents
- Agents can be reset without changing the agent id.
- Reset clears the stored context messages and appends a `reset` marker in history.
- Connectors are responsible for handling reset commands; the engine does not interpret slash commands.

## Key types
- `AgentMessage` stores message, context, and timestamps.
- `AgentState` holds mutable per-agent state.
- `FileReference` links attachments in the file store.
