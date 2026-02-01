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
