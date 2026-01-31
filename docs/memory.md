# Memory plugin

The memory plugin manages structured entities stored as Markdown files. Each entity is a lowercase English word (a-z only, no underscores). An `INDEX.md` file lists all entity types.

- Stored under `.scout/memory/` by default.
- `INDEX.md` enumerates entity types.
- `<entity>.md` contains `##` sections, one per record.

```mermaid
flowchart TD
  Create[memory_create_entity] --> Store[MemoryStore]
  Upsert[memory_upsert_record] --> Store
  Store --> Index[INDEX.md]
  Store --> Entity[<entity>.md]
```
