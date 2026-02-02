---
name: scheduling
description: Schedule recurring or time-based tasks. Use for alarms, reminders, periodic reviews, automated reports, or any task that should run at specific times or intervals.
---

# Scheduling

ClayBot supports two scheduling mechanisms: **cron** for precise timing and **heartbeats** for periodic check-ins.

## When to Use Cron

Use cron when:
- Exact timing matters (e.g., "every day at 9am")
- Tasks need their own isolated agent and memory
- One-off scheduled tasks (with `deleteAfterRun`)
- Tasks that produce artifacts in a dedicated workspace

**Cron tools:** `add_cron`, `cron_read_task`, `cron_read_memory`, `cron_write_memory`, `cron_delete_task`

### Cron Routing

Cron tasks run in their own dedicated cron agent by default. If you want the cron
notification to land in an existing agent (e.g. a user chat), include `agentId`
in `add_cron` to route the prompt to that agent instead.

## When to Use Heartbeats

Use heartbeats when:
- Approximate timing is acceptable (~30 minute intervals)
- Tasks need ongoing context from the main agent
- Prompts evolve over time and need periodic review
- Lightweight status checks or reminders

**Heartbeat tools:** `heartbeat_add`, `heartbeat_list`, `heartbeat_run`, `heartbeat_remove`

## Optional Exec Gate

Both cron and heartbeat tasks can define an optional `gate` command to decide
whether to run the LLM. The command runs first; exit code `0` means "run" and
non-zero means "skip." This keeps checks cheap (ex: ping before notifying).

`gate` supports:
- `command` (required)
- `cwd`, `timeoutMs`, `env`
- `permissions` (extra permissions, use tags like `@web`, `@read:/path`, `@write:/path`)
- `allowedDomains` (network allowlist; requires `@web`)

## Selection Examples

### Choose Cron

| User Input | Why Cron |
|------------|----------|
| "Remind me every day at 9am to check my emails" | Specific time (9am daily) |
| "Run a backup script every Sunday at midnight" | Exact schedule needed |
| "Send me a weather report every morning at 7:30" | Precise daily timing |
| "Every hour, check if the server is up" | Strict hourly repetition |
| "At 5pm on weekdays, summarize my tasks" | Complex schedule (weekdays only) |
| "Once tomorrow at noon, remind me about the meeting" | One-off scheduled task |
| "Every 15 minutes, poll the API for updates" | Precise interval timing |
| "On the 1st of each month, generate a report" | Calendar-based schedule |

### Choose Heartbeats

| User Input | Why Heartbeat |
|------------|---------------|
| "Periodically check on my project status" | Ongoing review, flexible timing |
| "Keep an eye on my git branches" | Continuous monitoring, evolving context |
| "Remind me about my todos from time to time" | Lightweight, approximate timing |
| "Check in on code quality occasionally" | Periodic review that needs reasoning |
| "Monitor my open PRs and update me" | Ongoing task that evolves |
| "Review my notes and suggest improvements" | Needs main agent context |
| "Periodically summarize what I've been working on" | Flexible interval, ongoing |
| "Keep track of my daily progress" | Continuous, evolving check-in |

### Ambiguous Cases

| User Input | Resolution |
|------------|------------|
| "Remind me about X regularly" | Ask: need exact times? Cron. Flexible? Heartbeat. |
| "Check something every day" | Ask: specific time? Cron. Anytime during day? Heartbeat. |
| "Monitor Y" | Heartbeat (monitoring implies ongoing, evolving context) |
| "Schedule Z" | Cron (scheduling implies specific timing) |

## Workflow

**For cron tasks:**
1. Determine the schedule (cron expression: `minute hour day month weekday`)
2. Use `add_cron` with name, schedule, and prompt (optional `agentId` + `gate`)
3. Each task gets isolated agent, memory file, and workspace

**For heartbeats:**
1. Run `heartbeat_list` to see existing tasks
2. Use `heartbeat_add` with title and prompt (optional `gate`)
3. Use `heartbeat_run` to trigger immediately
4. Use `heartbeat_remove` for cleanup

## Key Differences

| Feature | Cron | Heartbeats |
|---------|------|------------|
| Timing | Exact (cron expression) | ~30 minute intervals |
| Agent | Isolated per task | Shared main agent |
| Memory | Persistent `MEMORY.md` | Main agent context |
| Workspace | Dedicated `files/` dir | None |
| One-off | Yes (`deleteAfterRun`) | No |
| Best for | Time-sensitive tasks | Ongoing reviews |
