# Grambot dashboard

`gram-dashboard` is a Next.js app router UI styled with shadcn components.
API route handlers proxy `/api/*` requests to the local engine socket.

Default port: `7331` (set via `PORT` in the workspace scripts).

```mermaid
flowchart LR
  Browser[Browser] --> NextApp[Next.js App Router]
  NextApp -->|/api/* route handler| Proxy[API Proxy]
  Proxy --> Socket[scout.sock]
  Socket --> Engine[Engine server]
  NextApp -->|Server-rendered UI + client data| UI[Dashboard]
```

## Sessions streaming

The sessions views subscribe to the engine event stream and refresh session data when session events arrive.

```mermaid
flowchart LR
  UI[Sessions UI] -->|EventSource /api/v1/engine/events| Proxy[API Proxy]
  Proxy --> Socket[scout.sock]
  Socket --> Engine[Engine SSE]
  Engine -->|session.created / session.updated| UI
  UI -->|fetch /api/v1/engine/sessions| Proxy
```

## Session detail navigation

Session rows link to a dedicated detail page that loads the full log for that session.

```mermaid
flowchart LR
  List[Sessions list] -->|select storage id| Detail[Session detail]
  Detail -->|fetch /api/v1/engine/sessions/:storageId| Proxy[API Proxy]
  Proxy --> Socket[scout.sock]
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
scout root (SCOUT_ROOT_DIR, or `~/.dev` in development, or `~/.scout` otherwise) and then
falls back to common workspace locations.

```mermaid
flowchart TD
  Start[Incoming /api request] --> Env{SCOUT_ENGINE_SOCKET set?}
  Env -->|yes| EnvPath[Use resolved env path]
  Env -->|no| Root{SCOUT_ROOT_DIR set?}
  Root -->|yes| RootPath[Use SCOUT_ROOT_DIR/scout.sock]
  Root -->|no| Dev{NODE_ENV=development?}
  Dev -->|yes| DevPath[Use ~/.dev/scout.sock]
  Dev -->|no| ProdPath[Use ~/.scout/scout.sock]
  RootPath --> Exists{Socket exists?}
  DevPath --> Exists
  ProdPath --> Exists
  Exists -->|yes| UseDefault[Use default socket]
  Exists -->|no| Cwd[Check .scout/scout.sock in cwd]
  Cwd -->|found| UseCwd[Use cwd socket]
  Cwd -->|missing| RootFallback[Check workspace root .scout/scout.sock]
  RootFallback -->|found| UseRootFallback[Use workspace socket]
  RootFallback -->|missing| GramPkg[Check packages/gram/.scout/scout.sock]
  GramPkg -->|found| UseGram[Use gram package socket]
  GramPkg -->|missing| Fallback[Fallback to default socket path]
```
