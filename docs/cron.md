# Cron scheduler

Cron tasks are stored as markdown files on disk and are loaded at startup. Each task
has its own agent, memory file, and workspace.

## Task storage

Tasks live under `<config>/cron/<task-id>/`:
- `TASK.md` - frontmatter + prompt body
- `MEMORY.md` - task memory (initialized to `No memory`)
- `files/` - workspace directory for cron task file operations

Example `TASK.md`:
```markdown
---
taskId: clx9rk1p20000x5p3j7q1x8z1
name: Daily Report
schedule: "0 9 * * *"
enabled: true
agentId: cu3ql2p5q0000x5p3g7q1l8a9
gate:
  command: "ping -c 1 1.1.1.1 >/dev/null 2>&1"
  permissions:
    - "@web"
  allowedDomains:
    - 1.1.1.1
---

Generate the daily status report and summarize any blockers.
```

Frontmatter fields:
- `taskId` (required) - cuid2 identifier stored in frontmatter; tasks without a valid `taskId` are ignored
- `name` (required) - human-readable task name
- `schedule` (required) - 5-field cron expression (`minute hour day month weekday`)
- `enabled` (optional) - set to `false` to disable a task
- `description` (optional) - short description used by `cron_read_task`
- `deleteAfterRun` (optional) - when `true`, delete the task after it runs once
- `agentId` (optional) - route the cron prompt to an existing agent id (defaults to the cron agent)
- `gate` (optional) - exec gate config (command + permissions) that must succeed to run

Task directory ids should be human-friendly slugs (e.g. `create-image-in-morning`).

## Execution model

- `Crons` owns storage + scheduling (`CronStore` + `CronScheduler`).
- `CronScheduler` reads tasks from disk and schedules the next run.
- Each task runs in its own agent id (the `taskId` cuid2 from frontmatter) unless `agentId` routes elsewhere.
- If a `gate` is provided, the exec command must exit `0` for the task to run.
- When a schedule triggers, the task prompt is sent as a message to that agent.
- The system prompt includes the cron task metadata and the memory file location.

```mermaid
flowchart TD
  Engine[engine.ts] --> Crons[cron/crons.ts]
  Crons --> Store[cron/ops/cronStore.ts]
  Crons --> Scheduler[cron/ops/cronScheduler.ts]
  Scheduler --> Gate[execGateCheck]
  Gate -->|allow| AgentSystem[agents/agentSystem.ts]
  Gate -->|deny| Skip[Skip run]
```

## Exec Gate

`gate` runs a shell command before the LLM to decide if the cron should run.
Exit code `0` means "run"; non-zero means "skip." Use `gate.permissions` for
extra permissions (`@web`, `@read:/path`, `@write:/path`). Network access requires
`@web` plus `gate.allowedDomains` to allowlist hosts.

## Tools

- `add_cron` creates a new task on disk under `<config>/cron/`.
- `cron_read_task` reads a task's description and prompt.
- `cron_read_memory` reads a task's `MEMORY.md`.
- `cron_write_memory` overwrites (or appends to) a task's `MEMORY.md`.
- `cron_delete_task` deletes a task from disk and scheduler.
