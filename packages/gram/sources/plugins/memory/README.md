# Memory plugin

## Overview
The Memory plugin stores structured entities as Markdown files. Each entity is a lowercase English word (a-z only, no underscores) and lives in its own `*.md` file. An `INDEX.md` file lists all known entities.

## Storage layout
- Base folder (default: `${dataDir}/memory`)
  - `INDEX.md` — list of entity types
  - `<entity>.md` — Markdown records for that entity

`INDEX.md` is a simple list:

```md
# Memory Index

- person
- project
```

Each entity file starts with a heading and uses `##` sections for records:

```md
# person

## Ada Lovelace
Pioneer of computing.
```

## Tools
- `memory_create_entity`
  - Params: `entity`
  - Creates the entity file and adds it to `INDEX.md`.
- `memory_upsert_record`
  - Params: `entity`, `record`, `content`
  - Adds or updates a `## <record>` section with the given Markdown content.

## Settings
- `basePath` (optional): override memory storage directory. Defaults to `${dataDir}/memory`.
