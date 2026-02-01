# Heartbeats

Use heartbeats for periodic check-ins that should be reviewed or reasoned about.
Prefer cron for strict timing; prefer heartbeats for ongoing reviews.

Workflow:
- Run `heartbeat_list` to see current tasks.
- If missing, create with `heartbeat_add` (title + prompt).
- Use `heartbeat_run` to trigger immediately when verifying.
- Remove obsolete entries with `heartbeat_remove`.

Guidance:
- Keep prompts short and durable.
- Update the heartbeat prompt when context changes.
- Avoid adding redundant heartbeats.
