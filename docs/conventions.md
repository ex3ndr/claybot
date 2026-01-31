# Conventions

ClayBot keeps module boundaries explicit, avoids barrel `index.ts` files, and skips internal compatibility shims.

- Import modules directly (e.g., `./log.js`, `./plugins/telegram/connector.js`).
- Avoid internal compatibility shims between modules.

```mermaid
flowchart TD
  Direct[Direct imports] --> ModuleA[module file]
  Direct --> ModuleB[module file]
  ModuleA -. no barrels .-> None[(no index.ts)]
```
