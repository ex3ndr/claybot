# Cron Module

Manages scheduled task execution using cron expressions.

## Structure

```
cron/
├── cronTypes.ts                 # Type definitions
├── cronSlugify.ts               # Slugify strings for task IDs
├── cronCuid2Validate.ts         # Validate CUID2 identifiers
├── cronTaskUidResolve.ts        # Extract taskId from frontmatter
├── cronFrontmatterParse.ts      # Parse markdown frontmatter
├── cronFrontmatterSerialize.ts  # Serialize to markdown frontmatter
├── cronFieldParse.ts            # Parse single cron field
├── cronFieldMatch.ts            # Match value against cron field
├── cronExpressionParse.ts       # Parse 5-field cron expression
├── cronTimeGetNext.ts           # Calculate next run time
├── cronStore.ts                 # CronStore class (file persistence)
├── cronScheduler.ts             # CronScheduler class (task execution)
├── cronConnector.ts             # Cron connector (send-only)
└── README.md
```

## Pure Functions

All parsing and validation logic is extracted into pure functions:

- `cronSlugify(value)` - Convert string to URL-safe slug
- `cronCuid2Validate(value)` - Check if value is valid CUID2
- `cronTaskUidResolve(frontmatter)` - Extract taskId from frontmatter
- `cronFrontmatterParse(content)` - Parse YAML frontmatter from markdown
- `cronFrontmatterSerialize(frontmatter, body)` - Serialize to markdown
- `cronFieldParse(field, min, max)` - Parse single cron field
- `cronFieldMatch(field, value)` - Check if value matches cron field
- `cronExpressionParse(expression)` - Parse 5-field cron expression
- `cronTimeGetNext(expression, from?)` - Calculate next run time

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

### cronConnectorCreate

Factory function that creates a send-only connector for cron output.

## Usage

```typescript
import { CronStore } from "./cron/cronStore.js";
import { CronScheduler } from "./cron/cronScheduler.js";
import { cronConnectorCreate } from "./cron/cronConnector.js";

const store = new CronStore("/path/to/cron");
const scheduler = new CronScheduler({
  store,
  onTask: async (context, messageContext) => {
    // Handle task execution
  }
});

await scheduler.start();
```
