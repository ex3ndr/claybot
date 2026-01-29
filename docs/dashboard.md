# Scout dashboard

`scout-dashboard` is a static SPA served by a lightweight Node proxy.
The proxy serves the UI and forwards `/api/*` to the local engine socket.

Default port: `7331`.

```mermaid
flowchart LR
  Browser[Browser] --> Dashboard[scout-dashboard]
  Dashboard -->|/api| Socket[.scout/scout.sock]
  Socket --> Engine[Engine server]
  Dashboard -->|static files| UI[SPA]
```

## Engine socket resolution

The dashboard proxy prefers an explicit socket override. If none is set, it searches common locations in the
workspace and picks the first socket that exists.

```mermaid
flowchart TD
  Start[Incoming /api request] --> Env{SCOUT_ENGINE_SOCKET set?}
  Env -->|yes| EnvPath[Use resolved env path]
  Env -->|no| Cwd[Check .scout/scout.sock in cwd]
  Cwd -->|found| UseCwd[Use cwd socket]
  Cwd -->|missing| Root[Check workspace root .scout/scout.sock]
  Root -->|found| UseRoot[Use root socket]
  Root -->|missing| ScoutPkg[Check packages/scout/.scout/scout.sock]
  ScoutPkg -->|found| UseScout[Use scout package socket]
  ScoutPkg -->|missing| Fallback[Fallback to cwd socket path]
```
