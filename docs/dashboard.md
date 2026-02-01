# ClayBot dashboard

`claybot-dashboard` is a Next.js app router UI styled with shadcn components.
API route handlers proxy `/api/*` requests to the local engine socket.

Default port: `7331` (set via `PORT` in the workspace scripts).

```mermaid
flowchart LR
  Browser[Browser] --> NextApp[Next.js App Router]
  NextApp -->|/api/* route handler| Proxy[API Proxy]
  Proxy --> Socket[claybot.sock]
  Socket --> Engine[Engine server]
  NextApp -->|Server-rendered UI + client data| UI[Dashboard]
```

## Sessions streaming

The sessions views subscribe to the engine event stream and refresh session data when session events arrive.

```mermaid
flowchart LR
  UI[Sessions UI] -->|EventSource /api/v1/engine/events| Proxy[API Proxy]
  Proxy --> Socket[claybot.sock]
  Socket --> Engine[Engine SSE]
  Engine -->|session.created / session.updated| UI
  UI -->|fetch /api/v1/engine/sessions| Proxy
```

## Session type object

Sessions display a computed session type object so the UI can distinguish connections, scheduled work,
and background agent children.

```mermaid
flowchart TD
  Context[MessageContext] --> Cron{cron.taskUid or taskId}
  Context --> Heartbeat{heartbeat present}
  Context --> Agent{agent.kind=background}
  Context --> Connection{connector source + userId + channelId}
  Cron -->|yes| CronType[Type: cron]
  Heartbeat -->|yes| HeartbeatType[Type: heartbeat]
  Agent --> Parent{agent.parentSessionId}
  Parent -->|yes| BackgroundAgent[Type: background_agent]
  Parent -->|no| Background[Type: background]
  Connection -->|yes| ConnectionType[Type: connection]
  Connection -->|no| Background
```

## Session detail navigation

Session rows link to a dedicated detail page that loads the full log for that session.

```mermaid
flowchart LR
  List[Sessions list] -->|select storage id| Detail[Session detail]
  Detail -->|fetch /api/v1/engine/sessions/:storageId| Proxy[API Proxy]
  Proxy --> Socket[claybot.sock]
  Socket --> Engine[Engine sessions store]
```

## Overview layout

The overview page blends a stats strip, signal cards, and live panels.

```mermaid
flowchart TD
  Header[Header + Live Status] --> Stats[Stats strip]
  Stats --> Signals[Signal cards]
  Signals --> MainGrid[Main grid]
  MainGrid --> Activity[Activity chart]
  MainGrid --> Sessions[Active sessions table]
  MainGrid --> Inventory[Inventory tabs]
  MainGrid --> Cron[Cron tasks]
```

## Quick actions

Action cards jump to the most used operational screens.

```mermaid
flowchart LR
  Actions[Quick actions] --> Sessions[Sessions]
  Actions --> Automations[Automations]
  Actions --> Connectors[Connectors]
  Actions --> Providers[Providers]
```

## Engine socket resolution

The dashboard proxy prefers an explicit socket override. If none is set, it resolves a default
claybot root (CLAYBOT_ROOT_DIR, or `~/.dev` in development, or `~/.claybot` otherwise) and then
falls back to common workspace locations.

```mermaid
flowchart TD
  Start[Incoming /api request] --> Env{CLAYBOT_ENGINE_SOCKET set?}
  Env -->|yes| EnvPath[Use resolved env path]
  Env -->|no| Root{CLAYBOT_ROOT_DIR set?}
  Root -->|yes| RootPath[Use CLAYBOT_ROOT_DIR/claybot.sock]
  Root -->|no| Dev{NODE_ENV=development?}
  Dev -->|yes| DevPath[Use ~/.dev/claybot.sock]
  Dev -->|no| ProdPath[Use ~/.claybot/claybot.sock]
  RootPath --> Exists{Socket exists?}
  DevPath --> Exists
  ProdPath --> Exists
  Exists -->|yes| UseDefault[Use default socket]
  Exists -->|no| Cwd[Check .claybot/claybot.sock in cwd]
  Cwd -->|found| UseCwd[Use cwd socket]
  Cwd -->|missing| RootFallback[Check workspace root .claybot/claybot.sock]
  RootFallback -->|found| UseRootFallback[Use workspace socket]
  RootFallback -->|missing| ClaybotPkg[Check packages/claybot/.claybot/claybot.sock]
  ClaybotPkg -->|found| UseclayBot[Use claybot package socket]
  ClaybotPkg -->|missing| Fallback[Fallback to default socket path]
```
