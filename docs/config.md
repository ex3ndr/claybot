# Config

ClayBot uses an immutable Config snapshot that resolves paths, defaults, and settings
from the JSON settings file. The engine reloads by rebuilding a new Config snapshot.

## Snapshot fields

- `settingsPath`, `configDir`, `dataDir`, `filesDir`, `authPath`, `socketPath`, `workspaceDir`
- `settings` (validated settings.json)
- `defaultPermissions`
- `verbose` (runtime flag)

## Lifecycle

```mermaid
flowchart TD
  CLI[CLI writes settings.json] --> Load[configLoad.ts]
  Load --> Config[Config snapshot]
  Config --> Engine[engine.reload()]
  Engine --> Plugins[plugins.manager sync]
  Engine --> Providers[providers.manager sync]
  Engine --> Agents[agentSystem.reload]
```

## Reload flow

- CLI or UI updates `settings.json`
- `/v1/engine/reload` validates with schema and rebuilds Config
- Engine applies the new Config snapshot (paths must be unchanged)
