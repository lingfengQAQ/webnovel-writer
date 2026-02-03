# index.db 表结构说明 (v5.4，基于 v5.1/v5.2)

> 以 SQLite 存储大规模数据（实体/别名/场景/关系）。
>
> **v5.4**：结构沿用 v5.1/v5.2，并在脚本侧扩展新表。

## 表一览

### chapters
- chapter (INTEGER, PK)
- title (TEXT)
- location (TEXT)
- word_count (INTEGER)
- characters (TEXT)
- summary (TEXT)
- created_at (TIMESTAMP)

### scenes
- id (INTEGER, PK)
- chapter (INTEGER)
- scene_index (INTEGER)
- start_line (INTEGER)
- end_line (INTEGER)
- location (TEXT)
- summary (TEXT)
- characters (TEXT)

### appearances
- id (INTEGER, PK)
- entity_id (TEXT)
- chapter (INTEGER)
- mentions (TEXT)
- confidence (REAL)

### entities
- id (TEXT, PK)
- type (TEXT)
- canonical_name (TEXT)
- tier (TEXT)
- desc (TEXT)
- current_json (TEXT)
- first_appearance (INTEGER)
- last_appearance (INTEGER)
- is_protagonist (INTEGER)
- is_archived (INTEGER)

### aliases
- alias (TEXT)
- entity_id (TEXT)
- entity_type (TEXT)

### state_changes
- id (INTEGER, PK)
- entity_id (TEXT)
- field (TEXT)
- old_value (TEXT)
- new_value (TEXT)
- reason (TEXT)
- chapter (INTEGER)

### relationships
- id (INTEGER, PK)
- from_entity (TEXT)
- to_entity (TEXT)
- type (TEXT)
- description (TEXT)
- chapter (INTEGER)

> 实际字段以 `data_modules/index_manager.py` 为准。
