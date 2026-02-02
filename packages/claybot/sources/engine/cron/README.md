# Cron Module

Manages scheduled task execution using cron expressions.

## Structure

```
cron/
├── cronTypes.ts                 # Type definitions
├── ops/
│   ├── cronTaskUidResolve.ts        # Extract taskId from frontmatter
│   ├── cronFrontmatterParse.ts      # Parse markdown frontmatter
│   ├── cronFrontmatterSerialize.ts  # Serialize to markdown frontmatter
│   ├── cronFieldParse.ts            # Parse single cron field
│   ├── cronFieldMatch.ts            # Match value against cron field
│   ├── cronExpressionParse.ts       # Parse 5-field cron expression
│   ├── cronTimeGetNext.ts           # Calculate next run time
│   ├── cronStore.ts                 # CronStore class (file persistence)
│   └── cronScheduler.ts             # CronScheduler class (task execution)
├── crons.ts                     # Cron facade (storage + scheduling)
└── README.md
```

## Pure Functions

All parsing and validation logic lives in `ops/` as pure functions:

- `cronTaskUidResolve(frontmatter)` - Extract taskId from frontmatter
- `cronFrontmatterParse(content)` - Parse YAML frontmatter from markdown
- `cronFrontmatterSerialize(frontmatter, body)` - Serialize to markdown
- `cronFieldParse(field, min, max)` - Parse single cron field
- `cronFieldMatch(field, value)` - Check if value matches cron field
- `cronExpressionParse(expression)` - Parse 5-field cron expression
- `cronTimeGetNext(expression, from?)` - Calculate next run time

Shared utilities from `utils/`:
- `cuid2Is` - CUID2 validation
- `stringSlugify` - URL-safe slug generation

## Classes

### CronStore

Manages cron tasks stored as markdown files on disk.

```
/cron/<task-id>/
├── TASK.md     # Frontmatter (name, schedule, enabled) + prompt body
├── MEMORY.md   # Task memory
├── STATE.json  # Runtime state (lastRunAt)
└── files/      # Workspace for task files
```

### CronScheduler

Schedules and executes cron tasks based on their cron expressions.

## Usage

```typescript
import { CronStore } from "./cron/ops/cronStore.js";
import { CronScheduler } from "./cron/ops/cronScheduler.js";

const store = new CronStore("/path/to/cron");
const defaultPermissions = {
  workingDir: "/path/to/workspace",
  writeDirs: [],
  readDirs: [],
  web: false
};
const scheduler = new CronScheduler({
  store,
  defaultPermissions,
  onTask: async (context, messageContext) => {
    // Handle task execution
  }
});

await scheduler.start();
```
