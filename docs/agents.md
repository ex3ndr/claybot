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

## Agent routing rules
- Agent ids are cuid2 values mapped to `connector + channelId + userId`, cron task uid, or heartbeat.
- Connectors must provide `channelId` and `userId` for mapping.
- Messages (and files) are queued and processed in order via `AgentInbox`.

## System message routing
When `send_agent_message` omits a target agent id, the engine routes to the most recent
foreground user agent.

```mermaid
sequenceDiagram
  participant Subagent
  participant AgentSystem
  participant AgentIndex
  participant Connector
  Subagent->>AgentSystem: send_agent_message(text)
  AgentSystem->>AgentIndex: resolve most-recent-foreground
  AgentIndex-->>AgentSystem: agentId
  AgentSystem->>Connector: sendMessage(<system_message>)
```

## Agent persistence
- Agents are written to `.claybot/agents/<cuid2>/` as discrete files.
- `descriptor.json` captures the agent type and identity.
- `state.json` stores provider selection, permissions, routing, and timestamps.
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
Background agents emit a single failure notification to the parent agent.

```mermaid
sequenceDiagram
  participant Subagent
  participant AgentSystem
  participant ParentAgent
  Subagent-->>AgentSystem: notifySubagentFailure()
  AgentSystem->>ParentAgent: send_agent_message(failure)
```

## Background agent start
Starting a subagent enqueues work and returns immediately; the background agent continues processing asynchronously.

```mermaid
sequenceDiagram
  participant Foreground
  participant AgentSystem
  participant Subagent
  Foreground->>AgentSystem: start_background_agent(prompt)
  AgentSystem->>Subagent: enqueue message
  AgentSystem-->>Foreground: tool result (agent id)
```

## Resetting agents
- Agents can be reset without changing the agent id.
- Reset clears the stored context messages and appends a `reset` marker in history.
- Connectors are responsible for handling reset commands; the engine does not interpret slash commands.

## Key types
- `AgentMessage` stores message, context, and timestamps.
- `AgentState` holds mutable per-agent state.
- `FileReference` links attachments in the file store.
