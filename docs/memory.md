# Memory plugin

The memory plugin manages structured entities stored as Markdown files. Each entity is a lowercase English word (a-z only, no underscores). An `INDEX.md` file lists all entity types.

- Stored under `<workspace>/memory/` by default.
- `INDEX.md` enumerates entity types.
- `<entity>.md` contains frontmatter + `##` sections, one per record.
- Names must be short (<= 60 chars); descriptions must be short (<= 160 chars).

```mermaid
flowchart TD
  Create[memory_create_entity] --> Store[MemoryStore]
  List[memory_list_entities] --> Store
  Upsert[memory_upsert_record] --> Store
  Store --> Index[INDEX.md]
  Store --> Entity[<entity>.md]
```
