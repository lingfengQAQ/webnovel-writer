# 实体管理规范 (Entity Management Specification)

> **版本**: 5.4（基于 5.1 规范）
> **适用范围**: 所有实体类型（角色/地点/物品/势力/招式）
> **核心目标**: AI 驱动的实体提取、别名管理、版本追踪
>
> **v5.4**: 版本号对齐，规范沿用 v5.1。

---

## v5.1 变更

1. **SQLite 存储**: 实体、别名、状态变化、关系迁移到 `index.db`
2. **state.json 精简**: 仅保留进度、主角状态、节奏追踪（< 5KB）
3. **AI 提取**: Data Agent 从纯正文语义提取实体
4. **置信度消歧**: >0.8 自动采用，0.5-0.8 警告，<0.5 人工确认
5. **双 Agent 架构**: Context Agent (读) + Data Agent (写)

> **注意**: XML 标签仍可用于手动标注场景，但主流程不再要求。

---

## 一、存储架构 (v5.1)

### 1.1 数据分布

| 数据类型 | 存储位置 | 说明 |
|---------|---------|------|
| 实体 (entities) | index.db | SQLite entities 表 |
| 别名 (aliases) | index.db | SQLite aliases 表 (一对多) |
| 状态变化 | index.db | SQLite state_changes 表 |
| 关系 | index.db | SQLite relationships 表 |
| 章节索引 | index.db | SQLite chapters 表 |
| 场景索引 | index.db | SQLite scenes 表 |
| 进度/配置 | state.json | 精简 JSON (< 5KB) |
| 主角状态 | state.json | protagonist_state 快照 |
| 节奏追踪 | state.json | strand_tracker |

### 1.2 index.db Schema

```sql
-- 实体表
CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,  -- 角色/地点/物品/势力/招式
    canonical_name TEXT NOT NULL,
    tier TEXT DEFAULT '装饰',  -- 核心/重要/次要/装饰
    desc TEXT,
    current_json TEXT,  -- JSON 格式的当前状态
    first_appearance INTEGER,
    last_appearance INTEGER,
    is_protagonist INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);

-- 别名表 (一对多)
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
    chapter INTEGER,
    created_at TEXT
);

-- 关系表
CREATE TABLE relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_entity TEXT NOT NULL,
    to_entity TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    chapter INTEGER,
    created_at TEXT,
    UNIQUE(from_entity, to_entity, type)
);
```

### 1.3 各类实体特点

| 实体类型 | 别名复杂度 | 属性变化 | 层级关系 |
|---------|-----------|---------|---------|
| 角色    | 高（多种称呼）| 高（境界/位置/关系）| 无 |
| 地点    | 中（简称/全称）| 低（状态变化）| 有（省>市>区）|
| 物品    | 低（别称较少）| 中（升级/转移）| 无 |
| 势力    | 中（简称/别称）| 中（等级/领地）| 有（总部>分部）|
| 招式    | 低（别名少见）| 中（升级）| 无 |

---

## 二、处理流程 (v5.1)

### 2.1 Data Agent 自动提取

```
章节正文
    ↓
Data Agent (AI 语义分析)
    ↓
┌─────────────────────────────────────────────────────────┐
│ 1. 识别出场实体                                          │
│    - 匹配已有实体（通过 aliases 表）                      │
│    - 识别新实体，生成 suggested_id                       │
│                                                          │
│ 2. 置信度评估                                            │
│    ├─ > 0.8: 自动采用                                   │
│    ├─ 0.5-0.8: 采用但警告                               │
│    └─ < 0.5: 标记待人工确认                             │
│                                                          │
│ 3. 写入 index.db                                        │
│    - entities 表: 新实体/更新出场章节                    │
│    - aliases 表: 注册新别名                             │
│    - state_changes 表: 记录属性变化                     │
│    - relationships 表: 记录新关系                       │
│                                                          │
│ 4. 更新 state.json (精简)                               │
│    - protagonist_state: 主角状态快照                    │
│    - strand_tracker: 节奏追踪                           │
│    - disambiguation_warnings/pending: 消歧记录          │
└─────────────────────────────────────────────────────────┘
    ↓
index.db 更新完成
```

### 2.2 查询接口

```bash
# 查询实体
python -m data_modules.index_manager get-entity --id "xiaoyan" --project-root "."

# 查询核心实体
python -m data_modules.index_manager get-core-entities --project-root "."

# 通过别名查找
python -m data_modules.index_manager get-by-alias --alias "萧炎" --project-root "."

# 查询状态变化历史
python -m data_modules.index_manager get-state-changes --entity "xiaoyan" --project-root "."

# 查询关系
python -m data_modules.index_manager get-relationships --entity "xiaoyan" --project-root "."
```

---

## 三、标签体系 (可选)

> v5.1 主流程使用 Data Agent 自动提取。以下标签仅用于**手动标注场景**。

### 3.1 新建实体 (`<entity>`)

```xml
<entity type="角色" id="lintian" name="林天" desc="主角，觉醒吞噬金手指" tier="核心">
  <alias>废物</alias>
  <alias>那个少年</alias>
</entity>

<entity type="地点" id="tianyunzong" name="天云宗" desc="东域三大宗门之一" tier="核心">
  <alias>宗门</alias>
</entity>
```

### 3.2 添加别名 (`<entity-alias>`)

```xml
<entity-alias id="lintian" alias="林宗主" context="成为天云宗主后"/>
<entity-alias ref="林天" alias="不灭战神" context="晋升战神称号后"/>
```

### 3.3 更新属性 (`<entity-update>`)

```xml
<entity-update id="lintian">
  <set key="realm" value="筑基期一层" reason="血煞秘境突破"/>
  <set key="location" value="天云宗"/>
</entity-update>
```

**操作类型**:

| 操作 | 语法 | 说明 |
|------|------|------|
| set | `<set key="k" value="v"/>` | 设置属性值 |
| unset | `<unset key="k"/>` | 删除属性 |
| add | `<add key="k" value="v"/>` | 向数组添加元素 |
| remove | `<remove key="k" value="v"/>` | 从数组删除元素 |
| inc | `<inc key="k" delta="1"/>` | 数值递增 |

---

## 四、ID 生成规则

```python
def generate_entity_id(entity_type: str, name: str, existing_ids: set) -> str:
    """
    生成唯一实体 ID

    规则:
    1. 优先使用拼音（去空格、小写）
    2. 冲突时追加数字后缀
    3. 类型前缀: 物品→item_, 势力→faction_, 招式→skill_, 地点→loc_
    """
    prefix_map = {
        "物品": "item_",
        "势力": "faction_",
        "招式": "skill_",
        "地点": "loc_"
        # 角色无前缀
    }

    pinyin = ''.join(lazy_pinyin(name))
    base_id = prefix_map.get(entity_type, '') + pinyin.lower()

    final_id = base_id
    counter = 1
    while final_id in existing_ids:
        final_id = f"{base_id}_{counter}"
        counter += 1

    return final_id
```

---

## 五、错误处理

### 5.1 别名冲突

v5.1 允许 **aliases 一对多**：同一别名可以指向多个实体。

当 `ref="别名"` 命中多个实体且无法消歧时，报错：

```
⚠️ 别名歧义: '宗主' 命中 2 个实体，请改用 id 或补充 type 属性

解决方案:
  1. 改用稳定 id：<entity-update id="...">...</entity-update>
  2. 补充 type（仅能消歧跨类型；同类型重名仍需 id）
```

### 5.2 置信度处理

| 置信度范围 | 处理方式 |
|-----------|---------|
| > 0.8 | 自动采用，无需确认 |
| 0.5 - 0.8 | 采用建议值，记录 warning |
| < 0.5 | 标记待人工确认，不自动写入 |

---

## 六、迁移说明

从 v5.0 迁移到 v5.1：

```bash
# 运行迁移脚本
python -m data_modules.migrate_state_to_sqlite --project-root "." --backup

# 验证迁移结果
python -m data_modules.index_manager stats --project-root "."
```

迁移后：
- `index.db` 包含所有实体、别名、状态变化、关系
- `state.json` 仅保留进度、主角状态、节奏追踪
- 旧的 `entities_v3`、`alias_index` 字段会被清理

---

## 七、总结

### 7.1 v5.1 核心改进

1. **SQLite 存储**: 解决 state.json 膨胀问题
2. **精简 JSON**: state.json 保持 < 5KB
3. **一对多别名**: 同一别名可映射多个实体
4. **AI 自动提取**: Data Agent 语义分析替代 XML 标签

### 7.2 数据流

```
章节正文 → Data Agent → index.db (实体/别名/关系/状态变化)
                      → state.json (进度/主角状态/节奏)
                      → vectors.db (场景向量)
                              ↓
                      Context Agent → 下一章上下文
```
