# Durable Process Manager

Daycare now includes durable shell process tools that behave like a lightweight process supervisor.

## Goals

- Start commands as detached managed processes.
- Persist process state (pid, desired state, restart policy) on disk.
- Rehydrate managed process state after engine restart.
- Allow explicit stop operations (`process_stop`, `process_stop_all`).
- Persist process logs for later inspection (`process_logs`).

## Storage Model

Managed process state is stored per process in plugin data:

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
  A[process_start] --> B[Persist record.json + sandbox.json]
  B --> C[Spawn detached sandbox runtime process]
  C --> D[Append stdout/stderr to process.log]
  C --> E[Update pid/status in record.json]
  F[Engine restart] --> G[Plugin load]
  G --> H[Read process records from disk]
  H --> I{bootTime matches record?}
  I -- no --> J[Clear persisted pid as stale]
  I -- yes --> K{pid running?}
  K -- yes --> L[Adopt running process]
  K -- no --> M{desired=running and keepAlive=true}
  M -- yes --> N[Schedule exponential backoff]
  N --> O{backoff elapsed?}
  O -- yes --> P[Restart process]
  O -- no --> Q[Wait for next monitor tick]
  M -- no --> R[Mark exited/stopped]
  S[process_stop/process_stop_all] --> T[Set desired=stopped]
  T --> U[Kill process group]
  U --> V[Persist stopped status]
```

## Notes

- Keep-alive is opt-in per process via `process_start.keepAlive`.
- Reboot safety uses system boot time comparison; boot mismatch clears persisted pids.
- Keep-alive restarts use exponential backoff (2s base, doubling to 60s max) for crash loops.
- Stop operations apply to the full process group to terminate child processes.
- `process_logs` returns the full absolute log filename; read file contents via the `read` tool.
