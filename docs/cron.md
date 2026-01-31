# Cron scheduler

Cron tasks are stored as markdown files on disk and are loaded at startup. Each task
has its own session, memory file, and workspace.

## Task storage

Tasks live under `<config>/cron/<task-id>/`:
- `TASK.md` - frontmatter + prompt body
- `MEMORY.md` - task memory (initialized to `No memory`)
- `files/` - workspace directory for cron task file operations

Example `TASK.md`:
```markdown
---
name: Daily Report
schedule: "0 9 * * *"
enabled: true
---

Generate the daily status report and summarize any blockers.
```

Frontmatter fields:
- `name` (required) - human-readable task name
- `schedule` (required) - 5-field cron expression (`minute hour day month weekday`)
- `enabled` (optional) - set to `false` to disable a task

## Execution model

- `CronScheduler` reads tasks from disk and schedules the next run.
- Each task runs in its own session id: `cron:<task-id>`.
- When a schedule triggers, the task prompt is sent as a message to that session.
- The system prompt includes the cron task metadata and the memory file location.

## Tools

- `add_cron` creates a new task on disk under `<config>/cron/`.
- `cron_read_memory` reads a task's `MEMORY.md`.
- `cron_write_memory` overwrites (or appends to) a task's `MEMORY.md`.
