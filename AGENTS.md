# claybot agent notes

## Goals
- keep the core minimal and composable
- add integrations incrementally

## Conventions
- single workspace package at `packages/claybot`
- typescript only, esm output
- sources live in `sources/`
- tests use `*.spec.ts`
- tests must be minimal and live next to the file under test

## Build, Test, and Development Commands
- Runtime baseline: Node **22+**.
- Install deps: `yarn install`
- Run CLI in dev: `yarn dev`.
- Node remains supported for running built output (`dist/*`) and production installs.
- Type-check/build: `yarn typecheck` (tsc)
- Tests: `yarn test` (vitest);

## Coding Style & Naming Conventions
- Language: TypeScript (ESM). Prefer strict typing; avoid `any`.
- Add brief code comments for tricky or non-obvious logic.
- Keep files concise; extract helpers instead of "V2" copies.
- Aim to keep files under ~700 LOC; guideline only (not a hard guardrail). Split/refactor when it improves clarity or testability.
- Naming: use **ClayBot** for product/app/docs headings; use `claybot` for CLI command, package/binary, paths, and config keys.
- Use `@/types` for shared types whenever available instead of deep module imports.

## Logging
- Always create a logger with an explicit module via `getLogger("module.name")`.
- Module labels in pretty logs are normalized to 20 characters (trim or right-pad with spaces).
- Plugin modules must use the `plugin.` prefix so they render as `(module)`; system modules render as `[module]`.
- If a module is omitted or blank, logs use `unknown`.
- Prefer concise, stable module names to reduce trimming collisions.
- Pretty logs render as `[HH:MM:ss] [module     ] Message` (plugins render `(module     )`).

## Central Types (`@/types`)
- Prefer `import type { ... } from "@/types"` for shared/cross-cutting types.
- Add cross-cutting/public types to `sources/types.ts` and re-export there.
- Keep domain-internal types in their local modules.

## Plugin vs monolith
- If it is something contained - new inference provider, new API, memory engine. It should be a plugin.
- If it is requiring for coordinating multiple plugins or agents - it is part of the monilith. Cron is needed to everyone. Heartbeat too. Some event bus. Working with file system, sandboxing - it is part of the monolith code.
- Plugins are contained exclusively in a single folder (with subfolders)
- Each plugin folder must include a `README.md` documenting implementation details.
- See [`doc/PLUGINS.md`](doc/PLUGINS.md) for comprehensive plugin development guide.

## Agent-Specific Notes
- Never edit `node_modules` (global/Homebrew/npm/git installs too). Updates overwrite. Skill notes go in `tools.md` or `AGENTS.md`.
- When working on a GitHub Issue or PR, print the full URL at the end of the task.
- When answering questions, respond with high-confidence answers only: verify in code; do not guess.
- Patching dependencies (pnpm patches, overrides, or vendored changes) requires explicit approval; do not do this by default.
- If shared guardrails are available locally, review them; otherwise follow this repo's guidance.
- **Restart apps:** "restart iOS/Android apps" means rebuild (recompile/install) and relaunch, not just kill/launch.
- **Device checks:** before testing, verify connected real devices (iOS/Android) before reaching for simulators/emulators.
- **Multi-agent safety:** do **not** create/apply/drop `git stash` entries unless explicitly requested (this includes `git pull --rebase --autostash`). Assume other agents may be working; keep unrelated WIP untouched and avoid cross-cutting state changes.
- **Multi-agent safety:** when the user says "push", you may `git pull --rebase` to integrate latest changes (never discard other agents' work). When the user says "commit", scope to your changes only. When the user says "commit all", commit everything in grouped chunks.
- **Multi-agent safety:** do **not** create/remove/modify `git worktree` checkouts (or edit `.worktrees/*`) unless explicitly requested.
- **Multi-agent safety:** do **not** switch branches / check out a different branch unless explicitly requested.
- **Multi-agent safety:** running multiple agents is OK as long as each agent has its own agent directory.
- **Multi-agent safety:** when you see unrecognized files, keep going; focus on your changes and commit only those.
- **Multi-agent safety:** focus reports on your edits; avoid guard-rail disclaimers unless truly blocked; when multiple agents touch the same file, continue if safe; end with a brief "other files present" note only if relevant.
- Bug investigations: read source code of relevant npm dependencies and all related local code before concluding; aim for high-confidence root cause.
- Code style: add brief comments for tricky logic; keep files under ~500 LOC when feasible (split/refactor as needed).
- Never send streaming/partial replies to external messaging surfaces (WhatsApp, Telegram); only final replies should be delivered there. Streaming/tool events may still go to internal UIs/control channel.
- Release guardrails: do not change version numbers without operator's explicit consent; always ask permission before running any npm publish/release step.
- keep configs small and explicit
- avoid hidden side effects
- Permissions: parse permission strings (e.g. `@read:/path`) into a discriminated union; do not use optional path fields.
- commit after each ready-to-use change using Angular-style commits
- build before each commit and run tests
- document every change in `/docs/` with mermaid diagrams
- do not use barrel `index.ts` files
- avoid backward-compatibility shims for internal code

## Facade Classes
When a domain needs coordination logic (scheduling, resolving, registry), create a **plural-named facade class**:

| Domain object | Facade class | Responsibility |
|---------------|--------------|----------------|
| `Tool` | `Tools` | resolving, registration, execution |
| `Heartbeat` | `Heartbeats` | scheduling, lifecycle |
| `Agent` | `Agents` | lookup, creation, persistence |
| `Module` | `Modules` | loading, dependency wiring |

The facade owns the collection and coordination logic. Domain objects remain simple data or behavior units.

```typescript
// Heartbeat is a single heartbeat definition
interface Heartbeat { id: string; interval: number; action: () => void; }

// Heartbeats is the facade that manages all heartbeats
class Heartbeats {
  private items: Map<string, Heartbeat> = new Map();
  private scheduler: Scheduler;

  register(heartbeat: Heartbeat): void { /* ... */ }
  start(): void { /* ... */ }
  stop(): void { /* ... */ }
}
```

## Object Lifecycle
Do not implement `close()`, `dispose()`, or cleanup methods unless explicitly needed. Assume objects live forever in memory.

When cleanup **is** required (e.g., file handles, network connections, timers):
- Use `shutdown.ts` hooks for process-level cleanup
- Document why cleanup is necessary in a comment

Avoid patterns like disposable resources, reference counting, or manual memory management unless dealing with external resources.

## Utility Functions
Place general-purpose helpers in `sources/util/`. This includes:
- String manipulation (`stringUtils.ts`, `trimIdent.ts`)
- Time/date helpers (`time.ts`, `timeFormat.ts`, `isoDate.ts`)
- Async primitives (`lock.ts`, `sync.ts`, `debounce.ts`)
- Shutdown coordination (`shutdown.ts`)

Keep utilities **domain-agnostic**. If a helper is specific to a domain (e.g., permissions, agents), it belongs in that domain folder instead.

## Time Handling
Use **unix timestamps** (milliseconds since epoch) for all time values in the application. Only use `Date` objects at boundaries for parsing or formatting.

```typescript
// Good: store and pass around unix timestamps
const now = Date.now();
const expiresAt = now + 60_000; // 1 minute from now

function isExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt;
}

// Good: Date only for display/parsing
const formatted = new Date(expiresAt).toISOString();
const parsed = new Date("2025-01-15T10:00:00Z").getTime();

// Bad: passing Date objects around
function isExpired(expiresAt: Date): boolean { /* ... */ }
```

Why:
- **Simpler arithmetic**: `now + 60_000` vs `new Date(date.getTime() + 60_000)`
- **JSON-friendly**: numbers serialize cleanly
- **Immutable**: no accidental mutation
- **Comparable**: `a > b` works directly

## Async Patterns

### AsyncLock for Exclusive Code Blocks
Use `AsyncLock` when you need mutual exclusion in async code. Do not use timers, flags, or manual promise chains for this purpose.

```typescript
import { AsyncLock } from "@/util/lock.js";

const lock = new AsyncLock();

// Multiple callers queue up and execute sequentially
await lock.inLock(async () => {
  // Only one caller executes this block at a time
  await criticalOperation();
});
```

### InvalidateSync for Periodic Retry Handlers
Use `InvalidateSync` for operations that should be retried with backoff and coalesced when triggered multiple times (e.g., saving state to disk, syncing remote data).

```typescript
import { InvalidateSync } from "@/util/sync.js";

const sync = new InvalidateSync(async () => {
  await saveStateToDisk();
});

// Multiple rapid calls coalesce into one execution
sync.invalidate(); // triggers async command
sync.invalidate(); // marks for re-run after current completes
sync.invalidate(); // no-op, already marked

// Wait for completion if needed
await sync.invalidateAndAwait();
```

Key behaviors:
- **Backoff**: automatically retries on failure with exponential backoff
- **Coalescing**: rapid invalidations merge into at most two runs (current + one pending)
- **Stoppable**: call `stop()` to cancel pending work during shutdown

### ValueSync for Latest-Value Processing
Use `ValueSync` when you need to process the latest value asynchronously, dropping intermediate values:

```typescript
import { ValueSync } from "@/util/sync.js";

const sync = new ValueSync<State>(async (state) => {
  await persistState(state);
});

sync.setValue(state1); // starts processing
sync.setValue(state2); // replaces pending value
sync.setValue(state3); // replaces again; only state3 persists
```

## File Organization: One Function, Prefix Naming

### Core Principle
Write **one public function per file**. Name files and functions using **prefix notation** where the domain/noun comes first: `permissionCreate` not `createPermission`, `agentNormalize` not `normalizeAgent`.

### Why Prefix Notation
- **Autocomplete-friendly**: typing `permission` shows all permission operations
- **File explorer grouping**: related files cluster alphabetically (`permissionApply.ts`, `permissionCreate.ts`, `permissionFormat.ts`)
- **Import clarity**: `import { permissionCreate } from "./permissionCreate.js"` is self-documenting
- **Avoids verb collision**: no more `createSession`, `createPermission`, `createTask` scattered everywhere

### File Naming Convention
```
domainVerb.ts        # file name matches function name exactly
domainVerb.spec.ts   # unit test lives next to the file
```

Example: `permissionApply.ts` exports `permissionApply()`, tested in `permissionApply.spec.ts`.

### Underscore Prefix for Aggregation Files
Use an underscore prefix (`_`) for files that aggregate or combine multiple items into a single list or registry:

```
_modules.ts      # list of all modules to register
_skills.ts       # hardcoded skill definitions
_providers.ts    # all provider implementations
```

This distinguishes aggregation files from regular single-function files and makes them sort first in file explorers.

### Function Documentation
Each public function should have a brief comment describing its **purpose** and **expectations**:
```typescript
/**
 * Applies a permission decision to an existing permissions object.
 * Returns a new SessionPermissions with the approved path added.
 *
 * Expects: decision.approved === true; path must be absolute.
 */
export function permissionApply(
  permissions: SessionPermissions,
  decision: PermissionDecision
): SessionPermissions {
  // ...
}
```

Keep comments concise—purpose (what it does) and expectations (preconditions, constraints) in 2-4 lines.

### Internal Helpers Are OK
The "one public function per file" rule applies to **exported** functions. Internal helper functions within the same file are fine when they:
- Support the main exported function
- Are too small or specific to warrant their own file
- Would not be reused elsewhere

```typescript
// permissionApply.ts

/** Validates that a path is absolute and normalized. */
function validatePath(path: string): boolean {
  return path.startsWith("/") && !path.includes("/..");
}

/**
 * Applies a permission decision to an existing permissions object.
 * Expects: decision.approved === true; path must be absolute.
 */
export function permissionApply(
  permissions: SessionPermissions,
  decision: PermissionDecision
): SessionPermissions {
  if (!validatePath(decision.path)) {
    throw new Error("Invalid path");
  }
  // ...
}
```

If an internal helper grows complex or gets reused, extract it to its own file.

### Grouping by Domain
Organize files into domain folders. Each folder contains many small files:
```
engine/
  permissions/
    permissionApply.ts
    permissionBuildDefault.ts
    permissionFormatTag.ts
    permissionMerge.ts
    permissionTypes.ts         # types can share a file
  agents/
    agentNormalize.ts
    agentDescriptorBuild.ts
    agentKeyBuild.ts
  messages/
    messageBuildUser.ts
    messageExtractText.ts
    messageExtractToolCalls.ts
    messageFormatIncoming.ts
```

### Pure Functions First
- **Prefer pure functions**: input → output, no side effects, no mutations
- **Isolate impure code**: I/O, state mutations, and side effects go in clearly named files (`agent-persist.ts`, `connector-send.ts`)
- **Dependency injection**: pass dependencies as arguments rather than importing singletons

### Testing Pure Functions
Every pure function gets a unit test in `*.spec.ts` next to it:
```typescript
// permissionApply.ts
export function permissionApply(permissions: SessionPermissions, decision: PermissionDecision): SessionPermissions {
  // pure transformation, returns new object
}

// permissionApply.spec.ts
import { describe, it, expect } from "vitest";
import { permissionApply } from "./permissionApply.js";

describe("permissionApply", () => {
  it("adds write path when approved", () => {
    const result = permissionApply(basePermissions, writeDecision);
    expect(result.writeDirs).toContain("/new/path");
  });
});
```

### When to Combine
Some exceptions where multiple exports in one file make sense:
- **Type definitions**: group related types in `*-types.ts`
- **Tiny predicates**: `isCronContext()`, `isHeartbeatContext()` can share a file if under ~30 lines total
- **Tightly coupled pairs**: a function and its inverse (`encode`/`decode`)

### Migration Strategy
When refactoring large files:
1. Identify pure helper functions at the bottom of the file
2. Extract each to its own file with prefix naming
3. Write unit tests for extracted functions
4. Keep the orchestrating class/function that wires everything together
5. The orchestrator imports small, tested pieces

## Central Types: `@/types`

### Purpose
Consolidate shared type definitions in `sources/types.ts`, accessible via the `@/types` path alias. This provides a single import point for types used across plugins, engine, permissions, connectors, etc.

### Usage
```typescript
import type { SessionPermissions, MessageContext, PluginConfig } from "@/types";
```

### Rule
- Always import shared types via `@/types` when available; only the defining type files should use local module paths to avoid cycles.

### What Goes in `@/types`
- **Cross-cutting types**: types used by 3+ modules (e.g., `SessionPermissions`, `MessageContext`)
- **Public plugin API types**: types plugins need to implement or consume
- **Re-exports from domain modules**: aggregate exports for convenience

### What Stays in Domain Modules
- **Internal types**: types used only within a single domain folder
- **Implementation details**: types that are not part of the public API

### Structure
```typescript
// sources/types.ts
export type { SessionPermissions } from "./engine/permissions.js";
export type { MessageContext, ConnectorMessage } from "./engine/connectors/types.js";
export type { PluginConfig, PluginContext } from "./engine/plugins/types.js";
export type { FileReference } from "./files/types.js";
// ... more re-exports
```

### Path Alias Configuration
The `@/types` alias is configured in `tsconfig.json`:
```json
{
  "compilerOptions": {
    "paths": {
      "@/types": ["./sources/types.ts"]
    }
  }
}
```
