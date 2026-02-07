# Prompt files

Daycare injects editable Markdown files into the system prompt. Agents read them every turn and can update them to persist knowledge across sessions.

## Files

| File | Path | Purpose |
|------|------|---------|
| SOUL.md | `~/.daycare/SOUL.md` | Agent personality and behavioral refinements |
| USER.md | `~/.daycare/USER.md` | Stable user facts, preferences, and context |
| ACTORS.md | `~/.daycare/ACTORS.md` | Known agents, roles, and signal subscriptions |
| TOOLS.md | `~/.daycare/TOOLS.md` | Learned tool knowledge — tips, pitfalls, patterns |
| MEMORY.md | `~/.daycare/MEMORY.md` | Durable working notes and active context across sessions |

All five are automatically created from bundled templates on first run if missing.

## Lifecycle

```mermaid
flowchart TD
  Start[Agent receives message] --> Ensure[agentPromptFilesEnsure]
  Ensure --> Check{File exists?}
  Check -->|yes| Skip[Use existing]
  Check -->|no| Copy[Copy bundled template]
  Copy --> Disk["~/.daycare/<FILE>.md"]
  Skip --> Read[promptFileRead]
  Disk --> Read
  Read --> Context[Handlebars template context]
  Context --> Render["SYSTEM.md renders {{{soul}}}, {{{user}}}, {{{actors}}}, {{{tools}}}, {{{memory}}}"]
```

## Injection

- Foreground agents see all five files in their system prompt.
- Background agents do not receive SOUL, USER, ACTORS, TOOLS, or MEMORY.
- Paths are shown in the write permissions allowlist so agents can edit them.
- Content is injected via triple-brace Handlebars (`{{{actors}}}`) to avoid HTML escaping.

## Source templates

Bundled defaults live in `sources/prompts/`:
- `SOUL.md` — personality scaffold
- `USER.md` — blank user profile fields
- `ACTORS.md` — empty agent/subscription tables
- `TOOLS.md` — empty tool knowledge tables
- `MEMORY.md` — persistent working-memory template
