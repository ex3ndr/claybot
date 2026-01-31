# Memory plugin

## Overview
The Memory plugin stores structured entities as Markdown files. Each entity is a lowercase English word (a-z only, no underscores) and lives in its own `*.md` file. An `INDEX.md` file lists all known entities.

## Storage layout
- Base folder (default: `<workspace>/memory`)
  - `INDEX.md` — list of entity types
  - `<entity>.md` — Markdown records for that entity

`INDEX.md` is a simple list:

```md
# Memory Index

- person
- project
```

Each entity file includes frontmatter plus a heading, and uses `##` sections for records:

```md
---
name: "Ada Lovelace"
description: "Pioneer of computing."
---

# person

## Ada Lovelace
Pioneer of computing.
```

## Tools
- `memory_create_entity`
  - Params: `entity`, `name`, `description`
  - Creates or updates the entity file and adds it to `INDEX.md`.
- `memory_upsert_record`
  - Params: `entity`, `record`, `content`
  - Adds or updates a `## <record>` section with the given Markdown content.
- `memory_list_entities`
  - Params: `limit` (optional)
  - Lists entities with their short name/description for safe context inclusion.

## Constraints
- Entity: lowercase a-z only.
- Name: max 60 characters, single line.
- Description: max 160 characters, single line.

