# Scout documentation

This folder documents the current Scout CLI, connectors, sessions, and logging.

## Index
- `architecture.md` - system overview and message flow
- `cli.md` - CLI commands and runtime behavior
- `connectors.md` - connector abstraction and telegram connector
- `cron.md` - cron scheduler tasks and actions
- `auth.md` - auth tokens and helper commands
- `inference.md` - inference runtime helpers
- `containers.md` - container runtime management (Docker)
- `pm2.md` - pm2 runtime process management
- `util.md` - shared utility helpers
- `conventions.md` - import and compatibility rules
- `sessions.md` - session queueing and sequencing
- `config.md` - config files and resolution order
- `logging.md` - logging configuration and output
- `engine.md` - engine socket updates and control plane
- `testing.md` - current test coverage

```mermaid
flowchart TD
  Docs[Documentation] --> Arch[architecture.md]
  Docs --> CLI[cli.md]
  Docs --> Conn[connectors.md]
  Docs --> Sess[sessions.md]
  Docs --> Config[config.md]
  Docs --> Auth[auth.md]
  Docs --> Log[logging.md]
  Docs --> Engine[engine.md]
  Docs --> Test[testing.md]
  Docs --> PM2[pm2.md]
  Docs --> Containers[containers.md]
  Docs --> Util[util.md]
  Docs --> Conv[conventions.md]
  Docs --> Infer[inference.md]
```
