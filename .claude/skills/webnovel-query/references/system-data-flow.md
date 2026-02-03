---
name: system-data-flow
purpose: 项目初始化和状态查询时加载，理解数据结构
version: "5.4"
---

<context>
此文件用于项目数据结构参考。Claude 已知一般文件组织，这里只补充网文工作流特定的目录约定和脚本职责。
v5.4：版本号对齐，内容沿用 v5.2。
</context>

<instructions>

## 目录约定

```
项目根目录/
├── 正文/           # 章节文件（第0001章.md 或 第1卷/第001章-标题.md）
├── 大纲/           # 卷纲/章纲/场景纲
├── 设定集/         # 世界观/力量体系/角色卡/物品卡
└── .webnovel/
    ├── state.json          # 精简状态 (< 5KB)：进度/主角/strand_tracker/消歧
    ├── index.db            # SQLite 主存储：实体/别名/关系/状态变化/章节/场景
    ├── workflow_state.json # 工作流断点（用于 /webnovel-resume）
    ├── vectors.db          # RAG 向量数据库
    ├── summaries/          # 章节摘要（chNNNN.md）
    └── archive/            # 归档数据（不活跃角色/已回收伏笔）
```

## v5.1 架构变更

**核心变化**: 解决 state.json 膨胀问题（20章后 token 爆炸）

| 数据类型 | v5.0 存储位置 | v5.1 存储位置 |
|----------|--------------|--------------|
| entities_v3 | state.json | **index.db** (entities 表) |
| alias_index | state.json | **index.db** (aliases 表) |
| state_changes | state.json | **index.db** (state_changes 表) |
| structured_relationships | state.json | **index.db** (relationships 表) |
| progress | state.json | state.json (保留) |
| protagonist_state | state.json | state.json (保留) |
| strand_tracker | state.json | state.json (保留) |
| disambiguation_* | state.json | state.json (保留) |

## v5.2 双 Agent 架构

```
写作前: Context Agent 读取数据 → 组装上下文包
        ├── 从 state.json 读取精简数据（进度/配置）
        └── 从 index.db SQL 按需查询（实体/关系）

写作中: Writer 使用上下文包生成纯正文（无 XML 标签）

写作后: Data Agent 处理正文 → AI 提取实体 → 写入数据链
        ├── 写入 index.db（实体/别名/状态变化/关系）
        ├── 更新 state.json（进度/主角快照 + chapter_meta）
        └── 写入 summaries/chNNNN.md（章节摘要）

Context Agent (读) ←→ index.db + state.json ←→ Data Agent (写)
```

## 脚本/模块职责速查 (v5.1)

### 核心脚本

| 脚本 | 输入 | 输出 |
|------|------|------|
| `init_project.py` | 项目信息 | 生成 `.webnovel/state.json` + 初始化 `index.db` |
| `update_state.py` | 参数 | 原子更新 `state.json` 字段（进度/主角/strand_tracker） |
| `backup_manager.py` | 章节号 | 自动 Git 备份 |
| `status_reporter.py` | 无 | 生成健康报告/伏笔紧急度 |
| `archive_manager.py` | 无 | 归档不活跃数据 |
| `data_modules/migrate_state_to_sqlite.py` | 项目路径 | 迁移旧 state.json 到 SQLite (v5.1 新增) |

### data_modules 模块

| 模块 | 职责 |
|------|------|
| `state_manager.py` | 实体状态管理（精简 state.json + SQLite 同步） |
| `sql_state_manager.py` | SQLite 状态管理（v5.1 新增，替代 JSON 写入） |
| `index_manager.py` | SQLite 索引管理（实体/别名/关系/状态变化/章节/场景） |
| `entity_linker.py` | 别名注册与消歧 |
| `rag_adapter.py` | 向量嵌入与语义检索 |
| `style_sampler.py` | 风格样本提取与管理 |
| `api_client.py` | LLM API 调用封装 |
| `config.py` | 配置管理 |

## 每章数据链（v5.2 顺序）

```
1. Context Agent 组装创作任务书
   → 读取 state.json（精简版：进度/配置）
   → SQL 查询 index.db（核心实体/按需实体）
   → RAG 检索（相关场景）

2. Step 1.5 章节设计
   → 选开头/钩子/爽点模式（避开最近3章）

3. Writer 生成章节内容
   → 2A 粗稿（纯正文）
   → 2B 风格适配（可选）

4. 审查 (6 个 Agent 并行)
   → 爽点/一致性/节奏/OOC/连贯性/追读力检查
   → 输出审查报告

5. 网文化润色
   → 基于审查报告修复问题
   → 强化口感规则

6. Data Agent 处理数据链
   → AI 实体提取（替代 XML 标签解析）
   → 实体消歧（置信度策略）
   → 写入 index.db（实体/别名/状态变化/关系）
   → 更新 state.json（进度/主角快照 + chapter_meta）
   → 写入 summaries/chNNNN.md（章节摘要）
   → 向量嵌入 (RAG)
   → 风格样本评估

7. Git 备份（强制）
```

> `update_state.py` 用于手动/脚本化更新 `progress`/`protagonist_state`/`strand_tracker` 等字段；主流程通常由 Data Agent 在处理数据链时同步推进进度。

## state.json 精简结构 (v5.2)

```json
{
  "project_info": {"title": "", "genre": ""},
  "progress": {"current_chapter": N, "total_words": W, "current_volume": 1},
  "protagonist_state": {
    "name": "",
    "power": {"realm": "", "layer": 1, "bottleneck": ""},
    "location": {"current": "", "last_chapter": 0},
    "golden_finger": {"name": "", "level": 1, "skills": []}
  },
  "strand_tracker": {
    "last_quest_chapter": 0,
    "last_fire_chapter": 0,
    "last_constellation_chapter": 0,
    "current_dominant": "quest",
    "chapters_since_switch": 0,
    "history": []
  },
  "relationships": {},
  "plot_threads": {"active_threads": [], "foreshadowing": []},
  "world_settings": {},
  "disambiguation_warnings": [],
  "disambiguation_pending": [],
  "review_checkpoints": [],
  "chapter_meta": {},
  "_migrated_to_sqlite": true
}
```

> **v5.1 变更**: entities_v3、alias_index、state_changes、structured_relationships 已迁移到 index.db，不再存储在 state.json 中。

## index.db 表结构 (v5.1)

```sql
-- 实体表
CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,           -- 角色/地点/物品/势力/招式
    canonical_name TEXT NOT NULL,
    tier TEXT DEFAULT '装饰',     -- 核心/重要/次要/装饰
    desc TEXT,
    current_json TEXT,            -- JSON: {realm, location, ...}
    first_appearance INTEGER,
    last_appearance INTEGER,
    is_protagonist INTEGER DEFAULT 0,
    is_archived INTEGER DEFAULT 0
);

-- 别名表（一对多）
CREATE TABLE aliases (
    alias TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    PRIMARY KEY (alias, entity_id, entity_type)
);

-- 状态变化表
CREATE TABLE state_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    reason TEXT,
    chapter INTEGER NOT NULL
);

-- 关系表
CREATE TABLE relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_entity TEXT NOT NULL,
    to_entity TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    chapter INTEGER NOT NULL,
    UNIQUE(from_entity, to_entity, type)
);

-- 原有表（保留）
CREATE TABLE chapters (...);
CREATE TABLE scenes (...);
CREATE TABLE appearances (...);
```

## Data Agent AI 提取流程

v5.0 不再要求 XML 标签，由 Data Agent 智能提取：

1. **实体识别**: 从正文语义识别角色/地点/物品/势力
2. **实体匹配**: 优先匹配已有实体（通过 alias_index）
3. **消歧处理**:
   - 置信度 > 0.8: 自动采用
   - 置信度 0.5-0.8: 采用但记录 warning
   - 置信度 < 0.5: 标记待人工确认
4. **状态变化识别**: 境界突破/位置移动/关系变化
5. **写入存储**: 直接写入 index.db（实体/别名/关系/状态变化）

## 伏笔字段规范

| 字段 | 规范值 | 兼容值（历史） |
|------|--------|---------------|
| status | `未回收` / `已回收` | 待回收/进行中/active/pending |

**推荐字段**: content, status, planted_chapter, target_chapter, tier

## alias_index 格式 (v5.0 一对多)

```json
{
  "林天": [{"type": "角色", "id": "lintian"}],
  "天云宗": [
    {"type": "地点", "id": "loc_tianyunzong"},
    {"type": "势力", "id": "faction_tianyunzong"}
  ]
}
```

同一别名可映射到多个实体，消歧时根据 type 或上下文判断。

</instructions>

<examples>

<example>
<input>查询当前进度</input>
<output>
```bash
cat .webnovel/state.json | jq '.progress'
# 输出: { "current_chapter": 45, "total_words": 135000 }
```
</output>
</example>

<example>
<input>v5.1: 查询实体（SQL）</input>
<output>
```bash
python -m data_modules.index_manager get-entity --id "xiaoyan" --project-root "."
# 输出: {"id": "xiaoyan", "type": "角色", "canonical_name": "萧炎", ...}

python -m data_modules.index_manager get-core-entities --project-root "."
# 输出: 所有核心实体（主角 + tier=核心/重要）
```
</output>
</example>

<example>
<input>v5.1: 按别名查找实体（一对多）</input>
<output>
```bash
python -m data_modules.index_manager get-by-alias --alias "天云宗" --project-root "."
# 输出: [{"id": "loc_tianyunzong", "type": "地点"}, {"id": "faction_tianyunzong", "type": "势力"}]
```
</output>
</example>

<example>
<input>v5.1: 查询状态变化</input>
<output>
```bash
python -m data_modules.index_manager get-state-changes --entity "xiaoyan" --limit 10 --project-root "."
# 输出: [{entity_id, field, old_value, new_value, reason, chapter}, ...]
```
</output>
</example>

<example>
<input>v5.1: 查询关系</input>
<output>
```bash
python -m data_modules.index_manager get-relationships --entity "xiaoyan" --project-root "."
# 输出: [{from_entity, to_entity, type, description, chapter}, ...]
```
</output>
</example>

<example>
<input>检查伏笔紧急度</input>
<output>
```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/status_reporter.py" --focus urgency
```
</output>
</example>

<example>
<input>查询实体出场记录</input>
<output>
```bash
python -m data_modules.index_manager entity-appearances --entity "lintian" --project-root "."
```
</output>
</example>

<example>
<input>v5.1: 迁移旧 state.json 到 SQLite</input>
<output>
```bash
python -m data_modules.migrate_state_to_sqlite --project-root "." --backup
# 自动备份 state.json，迁移数据到 index.db，精简 state.json
```
</output>
</example>

</examples>

<errors>
❌ 伏笔状态写成"待回收" → ✅ 使用规范值"未回收"
❌ 手工更新忘记加 planted_chapter → ✅ 脚本已自动补全
❌ 归档路径混淆 → ✅ 固定为 `.webnovel/archive/*.json`
❌ alias_index 期望单对象 → ✅ v5.0+ 使用数组格式（一对多）
❌ 期望 XML 标签提取 → ✅ v5.0+ 由 Data Agent AI 自动提取
❌ 使用旧版 data_modules.state_manager schema → ✅ 统一使用 entities_v3 结构
❌ v5.1 仍从 state.json 读取 entities_v3 → ✅ 改用 SQL 查询 index.db
❌ v5.1 仍写入 state.json 大数据 → ✅ 改用 SQLite 增量写入
❌ v5.1 state.json 膨胀 → ✅ 运行迁移脚本: `python -m data_modules.migrate_state_to_sqlite`
</errors>
