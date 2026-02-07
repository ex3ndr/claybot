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
- desired state (`running` or `stopped`)
- observed status (`running`, `stopped`, `exited`)
- keep-alive flag and restart count

## Runtime Flow

```mermaid
flowchart TD
  A[process_start] --> B[Persist record.json + sandbox.json]
  B --> C[Spawn detached sandbox runtime process]
  C --> D[Append stdout/stderr to process.log]
  C --> E[Update pid/status in record.json]
  F[Engine restart] --> G[Plugin load]
  G --> H[Read process records from disk]
  H --> I{pid running?}
  I -- yes --> J[Adopt running process]
  I -- no --> K{desired=running and keepAlive=true}
  K -- yes --> L[Restart process]
  K -- no --> M[Mark exited/stopped]
  N[process_stop/process_stop_all] --> O[Set desired=stopped]
  O --> P[Kill process group]
  P --> Q[Persist stopped status]
```

## Notes

- Keep-alive is opt-in per process via `process_start.keepAlive`.
- Stop operations apply to the full process group to terminate child processes.
- Log access reads tail bytes and returns content without requiring direct file access.
