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
- Agent ids are cuid2 values mapped to user descriptors (`connector + channelId + userId`), cron task uid, or heartbeat.
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
When `send_agent_message` omits a target agent id, the tool asks for the most recent
foreground agent and posts a system message using the target agent’s connector.

```mermaid
flowchart LR
  Target[Target agent descriptor] --> Source[connector source]
  Source --> Post[agentSystem.post]
```

```mermaid
sequenceDiagram
  participant Subagent
  participant AgentSystem
  participant AgentInbox
  participant Agent
  Subagent->>AgentSystem: agentFor("most-recent-foreground")
  AgentSystem-->>Subagent: agentId
  Subagent->>AgentSystem: post(message)
  AgentSystem->>AgentInbox: enqueue(message)
  AgentInbox->>Agent: run
```

## Agent persistence
- Agents are written to `.claybot/agents/<cuid2>/` as discrete files.
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

## Resetting agents
- Agents can be reset without changing the agent id.
- Reset clears the stored context messages and appends a `reset` marker in history.
- Connectors are responsible for handling reset commands; the engine does not interpret slash commands.

## Key types
- `AgentMessage` stores message, context, and timestamps.
- `AgentState` holds mutable per-agent state.
- `FileReference` links attachments in the file store.
