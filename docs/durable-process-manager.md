# Durable Process Manager

Daycare now includes durable shell process tools that behave like a lightweight process supervisor.

## Goals

- Start commands as detached managed processes.
- Persist process state (pid, desired state, restart policy) on disk.
- Rehydrate managed process state after engine restart.
- Allow explicit stop operations (`process_stop`, `process_stop_all`).
- Expose absolute process log filenames via `process_list` and `process_get`.
- Provide engine API endpoints for dashboard monitoring.
- Support explicit `process_start.permissions` tags validated against caller permissions.

## Storage Model

Managed process state is stored per process in engine data:

- `processes/<id>/record.json`
- `processes/<id>/sandbox.json`
- `processes/<id>/process.log`

`record.json` is the source of truth for durable state, including:

- runtime pid (`pid`)
- boot identity (`bootTimeMs`) to detect stale pids after host reboot
- desired state (`running` or `stopped`)
- observed status (`running`, `stopped`, `exited`)
- keep-alive flag and restart count
- restart backoff state (`restartFailureCount`, `nextRestartAt`)

## Runtime Flow

```mermaid
flowchart TD
  A[shell plugin tools] --> B[Engine Processes facade]
  A --> A1[Validate requested permission tags]
  A1 --> A2[Build process sandbox permissions]
  A --> A0[No permissions provided]
  A0 --> A2z[Use zero write/network + read-all scope]
  A2 --> B
  A2z --> B
  B --> C[Persist record.json + sandbox.json]
  C --> D[Spawn detached sandbox runtime process]
  D --> E[Append stdout/stderr to process.log]
  D --> F[Update pid/status in record.json]
  G[Engine restart] --> H[Engine Processes load]
  H --> I[Read process records from disk]
  I --> J{bootTime matches record?}
  J -- no --> K[Clear persisted pid as stale]
  J -- yes --> L{pid running?}
  L -- yes --> M[Adopt running process]
  L -- no --> N{desired=running and keepAlive=true}
  N -- yes --> O[Schedule exponential backoff]
  O --> P{backoff elapsed?}
  P -- yes --> Q[Restart process]
  P -- no --> R[Wait for next monitor tick]
  N -- no --> S[Mark exited/stopped]
  T[process_stop/process_stop_all] --> U[Set desired=stopped]
  U --> V[Kill process group]
  V --> W[Persist stopped status]
  X[Dashboard] --> Y[/v1/engine/processes]
  Y --> B
  X --> Z[/v1/engine/processes/:processId]
  Z --> B
```

## Dashboard API

- `GET /v1/engine/processes`: list all managed durable processes.
- `GET /v1/engine/processes/:processId`: get one process by id.
- Responses include `logPath` so the dashboard can surface the full log filename.

## Notes

- Keep-alive is opt-in per process via `process_start.keepAlive`.
- `process_start.permissions` is optional:
  - Omitted: process runs with no network and no write grants (`network=false`, `writeDirs=[]`); reads stay globally allowed.
  - Provided: non-read tags are validated against caller permissions, then applied on top of that baseline (`@read:*` tags are ignored).
- Reboot safety uses system boot time comparison; boot mismatch clears persisted pids.
- Keep-alive restarts use exponential backoff (2s base, doubling to 60s max) for crash loops.
- Stop operations apply to the full process group to terminate child processes.
- `process_list` and `process_get` return the full absolute log filename; read file contents via the `read` tool.
