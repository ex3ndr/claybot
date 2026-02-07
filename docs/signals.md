# Signals

Signals are the broadcast event system for decoupled, multi-agent coordination. They complement direct messaging (`send_agent_message`): where direct messages are point-to-point and require knowing the recipient, signals are fire-and-forget broadcasts that any agent can subscribe to by pattern.

**When to use signals vs direct messages:**
- **Signals**: event notifications where multiple agents may react independently, and the producer doesn't need to know who listens. Examples: build completion, state changes, deployment events, agent lifecycle transitions.
- **Direct messages**: request/response interactions between specific agents, directed tasks, or when the sender needs an answer back.

Each signal has a distinct string `type` (colon-separated segments like `build:project-x:done`), an optional `data` payload, and a structured `source` identifying the origin.

Supported source variants:
- `{ type: "system" }` — internal system events (e.g. lifecycle signals)
- `{ type: "agent", id: string }` — emitted by an agent (default when using the tool)
- `{ type: "webhook", id?: string }` — triggered by an external webhook
- `{ type: "process", id?: string }` — emitted by a running process

## Runtime model

`Engine` owns a `Signals` facade (`sources/engine/signals/signals.ts`).
`Signals.generate()` creates a signal object, appends it to `<config>/signals/events.jsonl`, and emits `signal.generated` on the engine event bus.

Signal shape:
- `id` (cuid2)
- `type` (string id)
- `source` (discriminated object union)
- `data` (optional)
- `createdAt` (unix timestamp in milliseconds)

```mermaid
flowchart TD
  Agent[Agent] --> Tool[generate_signal tool]
  Tool --> Signals[Signals facade]
  Process[Process code] --> Signals
  Webhook[Webhook handler] --> Signals
  Signals --> Jsonl["<config>/signals/events.jsonl"]
  Signals --> EventBus[EngineEventBus]
  EventBus --> Event[signal.generated]
```

## Tool

The core tool `generate_signal` is registered for agent contexts.

Arguments:
- `type` (required string)
- `source` (optional object; defaults to `{ type: "agent", id: <current-agent-id> }` in tool usage)
- `data` (optional payload)

`signal_subscribe` is also registered for agent contexts.

Arguments:
- `pattern` (required string, `:` separated segments)
- `silent` (optional boolean, defaults to `true`)
- `agentId` (optional target agent id; defaults to current agent)

Wildcard matching supports only `*` as a segment placeholder.
Example:
- pattern `asdasd:*:asdasd`
- matches signal type `asdasd:anything:asdasd`

When a signal is generated, matching subscriptions are delivered immediately to agent inboxes:
- `silent=true` -> delivered as silent system messages
- `silent=false` -> delivered as regular system messages
- subscribing another agent requires that agent to exist; otherwise tool call fails
- delivery is handled as a dedicated `signal` inbox item and re-validated against current subscription state inside the agent loop (prevents unsubscribe races)
- delivery does not compare local timestamps; only current subscription presence is checked

`signal_unsubscribe` is also registered for agent contexts.

Arguments:
- `pattern` (required string, must exactly match the saved subscription pattern)
- `agentId` (optional target agent id; defaults to current agent)

Behavior:
- removes the subscription for `(agentId, pattern)` when it exists
- returns `removed=false` when there is nothing to remove
- unsubscribing another agent requires that agent to exist; otherwise tool call fails

## Dashboard API

The engine exposes persisted signal events for the dashboard:
- `GET /v1/engine/signals/events?limit=<n>`
- Returns `{ ok: true, events: Signal[] }`
- Default `limit` is `200`, max is `1000`

Signal reads and writes share a lock in `Signals`, so JSONL appends and dashboard reads stay ordered.

```mermaid
flowchart LR
  Dashboard[daycare-dashboard] --> Api["/api/v1/engine/signals/events"]
  Api --> Engine["engine/ipc/server.ts"]
  Engine --> Signals[Signals.listRecent]
  Signals --> Jsonl["<config>/signals/events.jsonl"]
```

## Delayed signals

`Engine` also owns a `DelayedSignals` facade (`sources/engine/signals/delayedSignals.ts`)
for wall-time scheduling.

Storage:
- `<config>/signals/delayed.json`
- persistent queue of delayed signal entries

Delivery model:
- `deliverAt` is a wall-time unix timestamp (milliseconds)
- entries are dispatched via `Signals.generate(...)` once due
- removal happens only after successful generation
- on generation failure, entry stays in queue and is retried
- semantics are **at least once**

Agent lifecycle signals:
- when an agent transitions to active: `agent:<agentId>:wake`
- when an agent transitions to sleeping: `agent:<agentId>:sleep`
- source is `system`

Repeat key behavior:
- each delayed entry may set `repeatKey`
- `repeatKey` is scoped by `type`
- scheduling `(type, repeatKey)` replaces older queued entry with same pair
- queued entries for `(type, repeatKey)` can be removed explicitly via `cancelByRepeatKey`

```mermaid
flowchart TD
  Producer[Schedule delayed signal] --> Queue[delayed.json queue]
  Queue --> Timer[DelayedSignals timer]
  Timer --> Due{deliverAt <= now}
  Due -->|no| Wait[wait until due]
  Due -->|yes| Generate[Signals.generate]
  Generate -->|success| Remove[remove from queue]
  Generate -->|error| Retry[keep in queue and retry]
```

```mermaid
flowchart LR
  New[Schedule type+repeatKey] --> Match{Existing same type+repeatKey?}
  Match -->|yes| Replace[delete old queued entry]
  Match -->|no| Keep[keep current queue]
  Replace --> Insert[insert new queued entry]
  Keep --> Insert
  Insert --> Queue[(delayed.json)]
```

```mermaid
flowchart TD
  AgentA[agent A] -->|signal_subscribe| Signals[Signals facade]
  AgentB[agent B] -->|signal_subscribe agentId=B| Signals
  Generator[generate_signal] --> Signals
  Signals --> Match["pattern match (* segments)"]
  Match --> Deliver[AgentSystem.post signal item]
  Deliver --> Validate[Agent re-checks subscription]
  Validate --> Silent[silent system message]
  Validate --> NonSilent[non-silent system message]
  AgentA -->|signal_unsubscribe| Signals
```

```mermaid
flowchart LR
  AgentSystem[AgentSystem] --> Wake[agent.woke transition]
  AgentSystem --> Sleep[agent.sleep transition]
  Wake --> GenerateWake["Signals.generate(agent:<id>:wake)"]
  Sleep --> GenerateSleep["Signals.generate(agent:<id>:sleep)"]
```
