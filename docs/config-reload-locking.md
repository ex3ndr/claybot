# Config reload locking

Engine config reload now applies online through `Engine.reload()` using `InvalidateSync`.
Reload requests coalesce; each sync run first checks for config changes outside the lock, then
re-reads and re-checks inside the runtime write lock before applying.
Runtime config state and lock now live in `ConfigModule` (`current config` + `configurationLock`),
and that module is shared across engine modules.
Modules now receive that shared module as `config` and call `config.inReadLock(...)` directly
instead of callback-style lock plumbing.
`AgentSystem` no longer exposes a `reload` method; config mutation is centralized in
`Engine.reloadApplyLatest()` via `ConfigModule.configSet(...)` under write lock.
Subsystem reload paths (`ProviderManager`, `PluginManager`) now refresh from `config.current`
without receiving config payloads or calling `configSet(...)`.

Read-locked runtime paths now include:
- connector message/command/permission handlers
- agent inbox item processing
- inference router completions
- cron scheduler task execution (tick scheduling is unlocked)
- heartbeat scheduler runs

This currently favors strict quiescence over reload latency: a config write lock
waits for in-flight inference calls to finish before applying changes.

Plugin/provider reload behavior during apply:
- providers: deep-equal settings are no-op; changed settings unload/load; unload always removes registry entries bound to the provider id
- plugins: deep-equal settings are no-op; changed settings unload/load; unload calls plugin `unload` first, then unregisters all registrar-owned modules
- plugin manager `load()` now unloads an already-loaded instance id before loading again, preventing stale tool/module registrations across restart-style reloads

Operational notes:
- connector callbacks catch and log failures so connector event loops do not produce unhandled promise rejections
- agent sleep persistence runs after inbox item read-lock work completes, so config reload is not blocked by sleep-state disk writes
- plugin inference clients now read settings via shared `ConfigModule` directly (no manager callback indirection)

```mermaid
sequenceDiagram
  participant API as Engine API
  participant Sync as InvalidateSync
  participant Lock as ReadWriteLock
  participant Engine
  participant Providers as ProviderManager
  participant Plugins as PluginManager

  API->>Engine: reload()
  Engine->>Sync: invalidateAndAwait()
  Sync->>Engine: load config + compare (no lock)
  Sync->>Lock: inWriteLock(apply latest config)
  Lock-->>Engine: write section entered (readers paused)
  Engine->>Engine: load config + compare again
  Engine->>Providers: reload()
  Engine->>Plugins: reload()
  Engine-->>Lock: apply complete
  Lock-->>Sync: release write lock
  Sync-->>API: reload resolved
```

```mermaid
flowchart TD
  Engine --> ConfigModule
  ConfigModule -->|current| AgentSystem
  ConfigModule -->|current| ProviderManager
  ConfigModule -->|current| PluginManager
  Engine -->|configSet under write lock| ConfigModule
  ConfigModule -->|inReadLock/inWriteLock| RuntimePaths
```

```mermaid
sequenceDiagram
  participant Tick as Cron Tick
  participant Scheduler as CronScheduler
  participant Lock as ReadWriteLock
  participant Task as executeTask

  Tick->>Scheduler: runTickUnlocked()
  Scheduler->>Task: schedule due task
  Task->>Lock: inReadLock(executeTaskUnlocked)
  Lock-->>Task: release after task completes
```

```mermaid
sequenceDiagram
  participant Inbox as Agent Inbox
  participant Lock as ReadWriteLock
  participant Agent as Agent Handler
  participant State as sleepIfIdle()

  Inbox->>Lock: inReadLock(handleInboxItem)
  Lock->>Agent: handle message/reset/permission
  Lock-->>Inbox: release read lock
  Inbox->>State: persist sleep state (if idle)
```
