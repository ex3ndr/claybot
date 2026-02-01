# Permissions

This document summarizes the permission helper functions extracted from the engine runtime.

```mermaid
flowchart TD
  Engine[Engine runtime] --> Default[permissionBuildDefault]
  Engine --> Cron[permissionBuildCron]
  Cron --> Ensure[permissionEnsureDefaultFile]
  Engine --> Merge[permissionMergeDefault]
  Engine --> Apply[permissionApply]
  Engine --> Tag[permissionFormatTag]
  Engine --> Describe[permissionDescribeDecision]

  subgraph Security[Path Security]
    Sanitize[pathSanitize]
    Resolve[pathResolveSecure]
    Open[openSecure]
  end

  Apply --> Sanitize
  Tools[Shell/File Tools] --> Resolve
  Tools --> Open
```

## Helper roles

- `permissionBuildDefault`: create the initial session permissions from workspace + config paths.
- `permissionBuildCron`: build cron-specific permissions that inherit defaults.
- `permissionEnsureDefaultFile`: merge default read/write directories into a session.
- `permissionMergeDefault`: combine existing session permissions with defaults.
- `permissionApply`: apply an approved permission decision to a session.
- `permissionFormatTag`: format the `@web`/`@read`/`@write` tag used in logs.
- `permissionDescribeDecision`: human-readable label for permission decisions.

## Path security utilities

The permissions system includes security hardening against path-based attacks:

### pathSanitize

Validates paths for dangerous characters and patterns. Rejects:

- **Null bytes** (`\x00`): Can truncate strings in C libraries
- **Control characters**: ASCII 0-31 (except tab/newline)
- **Excessive length**: Paths over 4096 characters

```typescript
import { pathSanitize } from "./pathSanitize.js";

pathSanitize("/valid/path");          // OK
pathSanitize("/path\x00/malicious");  // throws "Path contains null byte."
```

### pathResolveSecure

Securely resolves a path with symlink following and containment verification. Prevents symlink escape attacks by:

1. Resolving all symlinks via `fs.realpath()`
2. Checking containment against real paths

```typescript
import { pathResolveSecure } from "./pathResolveSecure.js";

const allowedDirs = ["/workspace"];
const { realPath, allowedBase } = await pathResolveSecure(allowedDirs, "/workspace/file.txt");
```

### openSecure

Opens a file handle with symlink protection to prevent TOCTOU (time-of-check to time-of-use) attacks:

```typescript
import { openSecure } from "./pathResolveSecure.js";

const handle = await openSecure("/workspace/file.txt", "r");
// File is guaranteed to be a regular file, not a symlink
```

## Security model

```mermaid
flowchart LR
  subgraph Input
    UserPath[User Path]
  end

  subgraph Validation
    Sanitize[pathSanitize]
    ResolveSecure[pathResolveSecure]
    OpenSecure[openSecure]
  end

  subgraph Attack Prevention
    NullByte[Null byte injection]
    Symlink[Symlink escape]
    TOCTOU[TOCTOU race]
  end

  UserPath --> Sanitize
  Sanitize -->|validates| NullByte
  Sanitize --> ResolveSecure
  ResolveSecure -->|prevents| Symlink
  ResolveSecure --> OpenSecure
  OpenSecure -->|prevents| TOCTOU
```

### Threats mitigated

| Threat | Mitigation | Location |
|--------|------------|----------|
| Symlink escape | `fs.realpath()` before containment check | `pathResolveSecure` |
| TOCTOU race | Atomic open with `lstat` + file handle | `openSecure`, handlers |
| Null byte injection | Path validation | `pathSanitize` |
| Control character injection | Path validation | `pathSanitize` |
| Path length DoS | 4096 char limit | `pathSanitize` |
| Empty workingDir bypass | Nullish coalescing | `permissionMergeDefault` |
