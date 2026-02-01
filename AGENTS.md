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

## Logging
- Always create a logger with an explicit module via `getLogger("module.name")`.
- Module labels in pretty logs are normalized to 20 characters (trim or right-pad with spaces).
- Plugin modules must use the `plugin.` prefix so they render as `(module)`; system modules render as `[module]`.
- If a module is omitted or blank, logs use `unknown`.
- Prefer concise, stable module names to reduce trimming collisions.
- Pretty logs render as `[HH:MM:ss] [module     ] Message` (plugins render `(module     )`).

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
- **Multi-agent safety:** running multiple agents is OK as long as each agent has its own session.
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

## File Organization: One Function, Prefix Naming

### Core Principle
Write **one public function per file**. Name files and functions using **prefix notation** where the domain/noun comes first: `permissionCreate` not `createPermission`, `sessionNormalize` not `normalizeSession`.

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
  sessions/
    sessionNormalize.ts
    sessionDescriptorBuild.ts
    sessionKeyBuild.ts
  messages/
    messageBuildUser.ts
    messageExtractText.ts
    messageExtractToolCalls.ts
    messageFormatIncoming.ts
```

### Pure Functions First
- **Prefer pure functions**: input → output, no side effects, no mutations
- **Isolate impure code**: I/O, state mutations, and side effects go in clearly named files (`session-persist.ts`, `connector-send.ts`)
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
