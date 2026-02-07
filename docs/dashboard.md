# Daycare dashboard

`daycare-dashboard` is a Next.js app router UI styled with shadcn components.
API route handlers proxy `/api/*` requests to the local engine socket.

Default port: `7331` (set via `PORT` in the workspace scripts).

```mermaid
flowchart LR
  Browser[Browser] --> NextApp[Next.js App Router]
  NextApp -->|/api/* route handler| Proxy[API Proxy]
  Proxy --> Socket[daycare.sock]
  Socket --> Engine[Engine server]
  NextApp -->|Server-rendered UI + client data| UI[Dashboard]
```

## Agents streaming

The agents views subscribe to the engine event stream and refresh agent data when agent events arrive.

```mermaid
flowchart LR
  UI[Agents UI] -->|EventSource /api/v1/engine/events| Proxy[API Proxy]
  Proxy --> Socket[daycare.sock]
  Socket --> Engine[Engine SSE]
  Engine -->|agent.created / agent.reset / agent.restored| UI
  UI -->|fetch /api/v1/engine/agents| Proxy
```

## Agent type object

Agents display a computed type object so the UI can distinguish connections, scheduled work,
and subagent children.

```mermaid
flowchart TD
  Descriptor[AgentDescriptor] --> Cron{type === cron}
  Descriptor --> SystemTag{type === system && tag === heartbeat}
  Descriptor --> Subagent{type === subagent}
  Descriptor --> Connection{type === user}
  Cron -->|yes| CronType[Type: cron]
  SystemTag -->|yes| HeartbeatType[Type: heartbeat]
  Subagent -->|yes| SubagentType[Type: subagent]
  Connection -->|yes| ConnectionType[Type: connection]
  Subagent -->|no| System[Type: system]
  Connection -->|no| System
```

## Agent lifecycle badges

Agent lifecycle state (active vs sleeping) is fetched from the agent list and displayed as
badges in the agents tables and detail view.

```mermaid
flowchart LR
  State[state.json state] --> List[GET /api/v1/engine/agents]
  List --> UI[Agents tables + detail view]
  UI --> Badge[Lifecycle badge]
```

## Agent detail navigation

Agent rows link to a dedicated detail page that loads the history for that agent.

```mermaid
flowchart LR
  List[Agents list] -->|select agent id| Detail[Agent detail]
  Detail -->|fetch /api/v1/engine/agents/:agentId/history| Proxy[API Proxy]
  Proxy --> Socket[daycare.sock]
  Socket --> Engine[Engine agent store]
```

## Agent list filtering

The agents page filters by type and search query before rendering the table.

```mermaid
flowchart LR
  Input[Search + type filter] --> Normalize[Normalize query]
  Normalize --> Filter[Filter agents by type + query]
  Filter --> Sort[Sort by updatedAt desc]
  Sort --> UI[Render agents table]
```

## Overview layout

The overview page blends a stats strip, signal cards, and live panels.

```mermaid
flowchart TD
  Header[Header + Live Status] --> Stats[Stats strip]
  Stats --> Signals[Signal cards]
  Signals --> MainGrid[Main grid]
  MainGrid --> Activity[Activity chart]
  MainGrid --> Agents[Active agents table]
  MainGrid --> Inventory[Inventory tabs]
  MainGrid --> Cron[Cron tasks]
  MainGrid --> Heartbeat[Heartbeat tasks]
```

## Quick actions

Action cards jump to the most used operational screens.

```mermaid
flowchart LR
  Actions[Quick actions] --> Agents[Agents]
  Actions --> Automations[Automations]
  Actions --> Connectors[Connectors]
  Actions --> Providers[Providers]
```

## Automations task views

The automations screen fetches both cron and heartbeat task lists on refresh and renders dedicated views for each.

```mermaid
flowchart LR
  Automations[Automations page] -->|fetch /api/v1/engine/cron/tasks| Proxy[API Proxy]
  Automations -->|fetch /api/v1/engine/heartbeat/tasks| Proxy
  Proxy --> Socket[daycare.sock]
  Socket --> Engine[Engine server]
  Engine --> CronData[Cron tasks]
  Engine --> HeartbeatData[Heartbeat tasks]
  CronData --> CronTable[Cron task table]
  HeartbeatData --> HeartbeatTable[Heartbeat task table]
```

## Engine socket resolution

The dashboard proxy prefers an explicit socket override. If none is set, it resolves a default
daycare root (DAYCARE_ROOT_DIR, or `~/.dev` in development, or `~/.daycare` otherwise) and then
falls back to common workspace locations.

```mermaid
flowchart TD
  Start[Incoming /api request] --> Env{DAYCARE_ENGINE_SOCKET set?}
  Env -->|yes| EnvPath[Use resolved env path]
  Env -->|no| Root{DAYCARE_ROOT_DIR set?}
  Root -->|yes| RootPath[Use DAYCARE_ROOT_DIR/daycare.sock]
  Root -->|no| Dev{NODE_ENV=development?}
  Dev -->|yes| DevPath[Use ~/.dev/daycare.sock]
  Dev -->|no| ProdPath[Use ~/.daycare/daycare.sock]
  RootPath --> Exists{Socket exists?}
  DevPath --> Exists
  ProdPath --> Exists
  Exists -->|yes| UseDefault[Use default socket]
  Exists -->|no| Cwd[Check .daycare/daycare.sock in cwd]
  Cwd -->|found| UseCwd[Use cwd socket]
  Cwd -->|missing| RootFallback[Check workspace root .daycare/daycare.sock]
  RootFallback -->|found| UseRootFallback[Use workspace socket]
  RootFallback -->|missing| DaycarePkg[Check packages/daycare/.daycare/daycare.sock]
  DaycarePkg -->|found| Usedaycare[Use daycare package socket]
  DaycarePkg -->|missing| Fallback[Fallback to default socket path]
```
