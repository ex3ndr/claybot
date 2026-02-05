# Config reload locking

Engine config reload now applies online through `Engine.reload()` using `InvalidateSync`.
Reload requests coalesce; each sync run loads config from disk, then applies it inside a runtime write lock.

Read-locked runtime paths now include:
- connector message/command/permission handlers
- agent inbox item processing
- inference router completions
- cron scheduler task execution/tick
- heartbeat scheduler runs

This currently favors strict quiescence over reload latency: a config write lock
waits for in-flight inference calls to finish before applying changes.

Plugin/provider reload behavior during apply:
- providers: deep-equal settings are no-op; changed settings unload/load; unload always removes registry entries bound to the provider id
- plugins: deep-equal settings are no-op; changed settings unload/load; unload calls plugin `unload` first, then unregisters all registrar-owned modules

```mermaid
sequenceDiagram
  participant API as Engine API
  participant Sync as InvalidateSync
  participant Lock as ReadWriteLock
  participant Engine
  participant Providers as ProviderManager
  participant Plugins as PluginManager

  API->>Engine: reload(nextConfig)
  Engine->>Sync: invalidateAndAwait()
  Sync->>Lock: inWriteLock(apply latest config)
  Lock-->>Engine: write section entered (readers paused)
  Engine->>Providers: sync()
  Engine->>Plugins: syncWithConfig()
  Engine-->>Lock: apply complete
  Lock-->>Sync: release write lock
  Sync-->>API: reload resolved
```
