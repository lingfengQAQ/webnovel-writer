# Webnovel-Writer 上下文工程升级方案 v1.2

> **状态**: 设计确认，待实施
> **参与者**: Claude (Opus 4.5) + Codex + 用户确认
> **日期**: 2026-02-02
> **v1.2 变更**: 修正向量存储路径、/learn 路径、依赖清单
> **兼容性**: 不考虑向前兼容（允许重建 `vectors.db` 与重跑索引）

---

## 一、关键决策确认

| 决策项 | 最终决定 | 理由 |
|--------|---------|------|
| 向量存储 | **保留 SQLite vectors.db** | 现有 rag_adapter 完整可用，重写成本高 |
| 父子文档 | **在 vectors 表增加 parent_chunk_id** | 无需新建 FAISS/scenes 目录 |
| 向前兼容 | **不考虑** | 允许重建 vectors.db 与父子索引 |
| /webnovel-learn 位置 | **skills/webnovel-learn/SKILL.md** | 遵循现有扩展体系，统一前缀 |
| 日志表位置 | **index.db** | 统一管理 |
| scenes/ 目录 | **不新建** | 场景数据存 scenes 表 + vectors 表 |

---

## 二、闭环确认清单（修正版）

| 模块 | 写入方 | 读取方 | 存储位置 | 状态 |
|------|--------|--------|---------|------|
| ContextManager | - | context-agent 调用 | 工具类（无持久化） | 待实现 |
| context_snapshots/ | context-agent | context-agent(下章) | .webnovel/context_snapshots/ | 待实现 |
| cli_output.py | - | 所有 CLI 输出 | 工具类 | 待实现 |
| schemas.py | - | data-agent 校验 | 工具类 | 待实现 |
| invalid_facts 表 | 用户+checker | context-agent | index.db | 待实现 |
| mark-invalid 命令 | 用户 | invalid_facts | index_manager.py | 待实现 |
| 父子向量索引 | data-agent | rag_adapter | vectors.db（重建+新增字段） | 待实现 |
| query_router.py | - | context-agent | 工具类 | 待实现 |
| 来源标注 | context-agent | 人读 | 任务书文本 | 待实现 |
| rag_query_log | rag_adapter | 手动SQL | index.db | 待实现 |
| tool_call_stats | CLI工具 | 手动SQL | index.db | 待实现 |
| preferences.json | 用户/init | context-agent | .webnovel/ | 待实现 |
| project_memory.json | /webnovel-learn | context-agent | .webnovel/ | 待实现 |

---

## 三、修正：向量存储方案

### 3.1 现有结构（保留）

```python
# rag_adapter.py 使用 SQLite 存储向量
# 表结构：
CREATE TABLE vectors (
    chunk_id TEXT PRIMARY KEY,
    chapter INTEGER,
    scene_index INTEGER,
    content TEXT,
    embedding BLOB,
    created_at TIMESTAMP
);
```

### 3.2 扩展方案（父子文档）

```sql
-- 不考虑向前兼容：重建 vectors 表（旧向量不保留）
DROP TABLE IF EXISTS vectors;
CREATE TABLE vectors (
    chunk_id TEXT PRIMARY KEY,
    chapter INTEGER,
    scene_index INTEGER,
    content TEXT,
    embedding BLOB,
    parent_chunk_id TEXT,
    chunk_type TEXT DEFAULT 'scene',  -- 'summary' | 'scene'
    source_file TEXT,                -- 来源文件路径
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_vectors_chapter ON vectors(chapter);
CREATE INDEX idx_vectors_parent ON vectors(parent_chunk_id);
CREATE INDEX idx_vectors_type ON vectors(chunk_type);
```

**父子关系**:
- 父块 (summary): chunk_type='summary', parent_chunk_id=NULL
- 子块 (scene): chunk_type='scene', parent_chunk_id='ch0100_summary'

**source_file 规范**:
- summary: `summaries/chNNNN.md`
- scene: `正文/第NNNN章.md#scene_{scene_index}`

**检索 + 回溯**:
```python
def search_with_backtrack(self, query: str, top_k: int = 5) -> list:
    # 1. 检索子块
    child_results = self._vector_search(query, chunk_type='scene', top_k=top_k*2)

    # 2. 收集父块 ID
    parent_ids = set(r.parent_chunk_id for r in child_results if r.parent_chunk_id)

    # 3. 查询父块上下文
    parent_contexts = self._get_chunks_by_ids(parent_ids)

    # 4. 合并返回
    return self._merge_results(parent_contexts, child_results[:top_k])
```

**实施方式**:
- 删除 `.webnovel/vectors.db` 后由 `rag_adapter` 重建
- 或在初始化阶段执行 `DROP TABLE IF EXISTS vectors` 并重建

---

## 四、修正：/learn 位置

### 4.1 目录结构

```
.claude/
├── skills/
│   ├── webnovel-learn/               # 【新增】学习命令
│   │   └── SKILL.md
│   ├── webnovel-init/
│   ├── webnovel-write/
│   └── ...
```

### 4.2 skills/webnovel-learn/SKILL.md

```markdown
---
name: webnovel-learn
description: 从当前会话中提取成功的写作模式并持久化到 project_memory.json
allowed-tools: Read Write Bash
---

# /webnovel-learn 命令

## 触发条件
- 用户主动调用 /webnovel-learn
- 章节审查得分 > 85 时提示用户调用

## 执行流程
1. 分析当前会话中的成功模式
2. 提取可复用的技巧（钩子设计、节奏控制、对话技巧等）
3. 写入 `.webnovel/project_memory.json`

## 输入
```bash
/webnovel-learn "本章的危机钩设计很有效，悬念拉满"
```

## 输出
```json
{
  "status": "success",
  "learned": {
    "pattern_type": "hook",
    "description": "危机钩设计：悬念拉满",
    "source_chapter": 100,
    "learned_at": "2026-02-02T12:00:00Z"
  }
}
```
```

---

## 五、修正：依赖清单

### 5.1 requirements.txt 更新

```txt
# Webnovel Writer - Python Dependencies
# Python >= 3.8 required

# 核心依赖
aiohttp>=3.8.0          # 异步 HTTP 客户端（API 调用）
filelock>=3.0.0         # 文件锁（状态文件并发控制）
pydantic>=2.0.0         # 【新增】Schema 校验

# 可选依赖（开发/测试）
pytest>=7.0.0           # 单元测试
pytest-cov>=4.1.0       # 覆盖率统计
```

---

## 六、invalid_facts 详细设计（保持不变）

### 6.1 表结构

```sql
CREATE TABLE invalid_facts (
    id INTEGER PRIMARY KEY,
    source_type TEXT NOT NULL,      -- entity/relationship/state_change
    source_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'pending',  -- pending/confirmed
    marked_by TEXT NOT NULL,        -- user/consistency-checker
    marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP,
    chapter_discovered INTEGER
);

CREATE INDEX idx_invalid_status ON invalid_facts(status);
CREATE INDEX idx_invalid_source ON invalid_facts(source_type, source_id);
```

### 6.2 CLI 命令

```bash
# 标记无效
python -m data_modules.index_manager mark-invalid \
    --source-type entity \
    --source-id 123 \
    --reason "境界描述与第50章矛盾" \
    --chapter 75 \
    --project-root "."

# 确认无效
python -m data_modules.index_manager resolve-invalid \
    --id 1 --action confirm --project-root "."

# 查看待确认
python -m data_modules.index_manager list-invalid \
    --status pending --project-root "."
```

### 6.3 consistency-checker 集成

需要在 `consistency-checker.md` 的 Step 4 后增加：

```markdown
### Step 5: 标记无效事实（新增）

对于发现的 CRITICAL 级别问题，自动标记到 invalid_facts：

```bash
python -m data_modules.index_manager mark-invalid \
    --source-type entity \
    --source-id {entity_id} \
    --reason "{问题描述}" \
    --marked-by consistency-checker \
    --chapter {current_chapter} \
    --project-root "."
```

**注意**: 自动标记的状态为 `pending`，需用户确认后才生效。
```

---

## 七、日志表设计

### 7.1 rag_query_log（在 index.db）

```sql
CREATE TABLE rag_query_log (
    id INTEGER PRIMARY KEY,
    query TEXT,
    query_type TEXT,           -- entity/plot/scene/setting
    results_count INTEGER,
    hit_sources TEXT,          -- JSON: {"summary": 2, "scene": 3}
    latency_ms INTEGER,
    chapter INTEGER,           -- 发起查询的章节
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rag_query_type ON rag_query_log(query_type);
CREATE INDEX idx_rag_query_chapter ON rag_query_log(chapter);
```

### 7.2 tool_call_stats（在 index.db）

```sql
CREATE TABLE tool_call_stats (
    id INTEGER PRIMARY KEY,
    tool_name TEXT,
    success BOOLEAN,
    retry_count INTEGER DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    chapter INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tool_stats_name ON tool_call_stats(tool_name);
CREATE INDEX idx_tool_stats_chapter ON tool_call_stats(chapter);
```

---

## 八、目录结构（修正版）

```
.claude/
├── scripts/
│   └── data_modules/
│       ├── context_manager.py      # 【新增】上下文管理器
│       ├── cli_output.py           # 【新增】统一输出格式
│       ├── schemas.py              # 【新增】Pydantic Schema
│       ├── query_router.py         # 【新增】查询路由器 (阶段2)
│       ├── snapshot_manager.py     # 【新增】快照版本管理
│       ├── index_manager.py        # 【修改】增加 invalid_facts + 日志表
│       └── rag_adapter.py          # 【修改】增加父子索引 + 回溯
├── skills/
│   └── webnovel-learn/                 # 【新增】阶段3
│       └── SKILL.md
├── agents/
│   ├── context-agent.md            # 【修改】集成 ContextManager + 来源标注
│   └── consistency-checker.md      # 【修改】集成 invalid_facts 写入
└── references/
    └── context-engineering-upgrade-plan-v1.2.md  # 本文档

.webnovel/  # (在用户的小说项目中)
├── context_snapshots/              # 【新增】上下文快照
│   └── ch0100.json
├── index.db                        # 现有（增加新表）
├── vectors.db                      # 现有（增加字段）
├── state.json                      # 现有
├── summaries/                      # 现有
├── preferences.json                # 【新增】阶段3
└── project_memory.json             # 【新增】阶段3
```

**注意**: 删除了原计划中的：
- `.webnovel/scenes/` 目录（场景数据存表）
- `.webnovel/vectors/*.faiss` 文件（保留 SQLite）

---

## 九、阶段划分（修正版）

### 阶段1：上下文控制与结构化输出

| 任务 | 文件 | 变更类型 | 依赖 |
|------|------|---------|------|
| 1. requirements.txt 更新 | requirements.txt | 修改 | 无 |
| 2. invalid_facts 表 | index_manager.py | 新增表 | 无 |
| 3. mark-invalid 命令 | index_manager.py | 新增命令 | 任务2 |
| 4. resolve-invalid 命令 | index_manager.py | 新增命令 | 任务2 |
| 5. list-invalid 命令 | index_manager.py | 新增命令 | 任务2 |
| 6. cli_output.py | 新文件 | 新增 | 无 |
| 7. schemas.py | 新文件 | 新增 | 任务1 |
| 8. snapshot_manager.py | 新文件 | 新增 | 任务6 |
| 9. ContextManager | 新文件 | 新增 | 任务6,7,8 |
| 10. consistency-checker 集成 | agents/*.md | 修改 | 任务3 |
| 11. context-agent 集成 | agents/*.md | 修改 | 任务9 |

### 阶段2：RAG 增强

| 任务 | 文件 | 变更类型 | 依赖 |
|------|------|---------|------|
| 1. vectors 表重建（不兼容） | rag_adapter.py | 修改表结构 | 无 |
| 2. 父子索引构建 | rag_adapter.py | 新增方法 | 任务1 |
| 3. 回溯检索 | rag_adapter.py | 新增方法 | 任务2 |
| 4. query_router.py | 新文件 | 新增 | 无 |
| 5. rag_query_log 表 | index_manager.py | 新增表 | 无 |
| 6. tool_call_stats 表 | index_manager.py | 新增表 | 无 |
| 7. 来源标注 | context-agent.md | 修改输出 | 任务3 |
| 8. data-agent 集成 | data-agent.md | 修改 | 任务1,2 |

### 阶段3：记忆与评估

| 任务 | 文件 | 变更类型 | 依赖 |
|------|------|---------|------|
| 1. preferences.json 设计 | 文档 | 设计 | 无 |
| 2. project_memory.json 设计 | 文档 | 设计 | 无 |
| 3. skills/webnovel-learn/SKILL.md | 新文件 | 新增 | 任务2 |
| 4. 置信度过滤 | context_manager.py | 新增方法 | 阶段1 |
| 5. context-agent 读取记忆 | context-agent.md | 修改 | 任务1,2 |

---

## 十、验收标准（修正版）

### 阶段1 验收

- [ ] requirements.txt 包含 pydantic>=2.0.0
- [ ] index.db 包含 invalid_facts 表
- [ ] mark-invalid / resolve-invalid / list-invalid 命令可用
- [ ] consistency-checker 可自动写入 pending 状态
- [ ] context-agent 过滤 confirmed，提示 pending
- [ ] cli_output.py 提供统一的 success/error 格式
- [ ] schemas.py 提供 DataAgentOutput 等 Schema
- [ ] snapshot_manager.py 可保存/加载快照
- [ ] ContextManager 可按优先级组装上下文

### 阶段2 验收

- [ ] vectors.db 已重建（旧向量不保留）
- [ ] vectors.db 包含 parent_chunk_id, chunk_type 字段
- [ ] data-agent 写入时设置正确的父子关系
- [ ] rag_adapter 支持 search_with_backtrack
- [ ] query_router 可按问题类型分流
- [ ] index.db 包含 rag_query_log, tool_call_stats 表
- [ ] 任务书包含来源标注

### 阶段3 验收

- [ ] preferences.json 可被 context-agent 读取
- [ ] project_memory.json 可被 context-agent 读取
- [ ] /webnovel-learn 命令可写入 project_memory.json
- [ ] 置信度过滤生效

---

*文档版本: 1.2*
*状态: 设计确认，待实施*
*日期: 2026-02-02*
