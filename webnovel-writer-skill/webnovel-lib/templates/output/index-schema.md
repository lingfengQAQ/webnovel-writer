# index.db 表结构说明

> 以 SQLite 存储大规模数据（实体/别名/场景/关系）。
>
> 当前结构包含追读力/可观测性相关表。

## 表一览

### 核心索引表

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

### 追读力债务相关表
- override_contracts
- chase_debt
- debt_events
- chapter_reading_power

### 可观测性与审查相关表
- invalid_facts
- review_metrics
- rag_query_log
- tool_call_stats
- writing_checklist_scores

> 实际字段与约束以 `.claude/scripts/data_modules/index_manager.py` 为准。
