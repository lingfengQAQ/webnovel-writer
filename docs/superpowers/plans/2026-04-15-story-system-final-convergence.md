# Story System 最终收束实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Story System 从"半成品并存"收束到"六层主链 + 消费端同步"的最终可用状态，覆盖 CSV_CONFIG 注册、裁决表、engine 改造、context_manager 瘦身、旧散写清理、projection 收束、消费端同步和向量索引增强共 9 个 section。

**Architecture:** 自底向上串行推进。先在 `reference_search.py` 引入 per-table `CSV_CONFIG`，然后统一 CSV 毒点列名、新建裁决表、改造 `story_system_engine.py` 接入裁决层，接着瘦身 `context_manager.py`、清理旧散写路径、收束 projection 层，最后同步所有消费端 prompt 并增强向量索引。

**Tech Stack:** Python 3.11+, pytest, CSV (UTF-8 BOM), SQLite FTS5, RAG embedding

**Spec:** `docs/superpowers/specs/2026-04-14-story-system-final-convergence-spec.md`

---

## 文件结构总览

### 新建文件

| 文件 | 职责 |
|------|------|
| `webnovel-writer/references/csv/裁决规则.csv` | reasoning 层，key=题材，裁决命中条目的优先级和注入位置 |
| `webnovel-writer/scripts/data_modules/knowledge_query.py` | 时序查询接口，entity_state_at_chapter / relationships_at_chapter |
| `webnovel-writer/scripts/data_modules/vector_projection_writer.py` | commit 后把事件/entity_delta 写入向量库 |
| `webnovel-writer/scripts/data_modules/tests/test_csv_config.py` | CSV_CONFIG 与 CSV 表头对齐校验 |
| `webnovel-writer/scripts/data_modules/tests/test_reasoning_engine.py` | 裁决层单元测试 |
| `webnovel-writer/scripts/data_modules/tests/test_knowledge_query.py` | 时序查询单元测试 |
| `webnovel-writer/scripts/data_modules/tests/test_vector_projection_writer.py` | 向量投影写入测试 |

### 主要修改文件

| 文件 | 改动摘要 |
|------|---------|
| `webnovel-writer/scripts/reference_search.py` | 引入 `CSV_CONFIG`，`search()` 按表使用不同 `search_cols` |
| `webnovel-writer/scripts/data_modules/story_system_engine.py` | 接入裁决表，新增 `_load_reasoning` / `_apply_reasoning` / `_rank_anti_patterns` / `_assemble_contract` |
| `webnovel-writer/scripts/data_modules/context_manager.py` | 删 snapshot 逻辑、删 `_compact_json_text` / text 渲染相关，压到 400 行以下 |
| `webnovel-writer/scripts/extract_chapter_context.py` | `_render_text()` 改为纯 JSON 序列化，text 渲染不再由代码层负责（context-agent 按示例写任务书） |
| `webnovel-writer/scripts/data_modules/event_projection_router.py` | 给 6 种事件加 `"vector"` 路由 |
| `webnovel-writer/scripts/data_modules/chapter_commit_service.py` | `apply_projections` 接入 `VectorProjectionWriter` |
| `webnovel-writer/scripts/data_modules/state_projection_writer.py` | 统一由 projection 推进 `chapter_status` |
| `webnovel-writer/skills/webnovel-write/SKILL.md` | 删 Step 2/4 的 `set-chapter-status`、删 `core-constraints` / `anti-ai-guide` 直读 |
| `webnovel-writer/agents/context-agent.md` | 确认工具段落、research 数据源路径与代码一致 |
| `webnovel-writer/agents/data-agent.md` | 确认不直写 state/index/memory |
| `webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py` | 新增散写检测断言 |
| `webnovel-writer/scripts/data_modules/tests/test_event_projection_router.py` | 补 vector 路由测试 |
| `webnovel-writer/scripts/data_modules/tests/test_story_system_engine.py` | 补裁决层测试 |
| `webnovel-writer/scripts/tests/test_reference_search.py` | 补 per-table search_cols 测试 |
| `webnovel-writer/references/csv/*.csv` | 毒点列统一 rename |

### 删除文件

| 文件 | 理由 |
|------|------|
| `webnovel-writer/scripts/data_modules/snapshot_manager.py` | snapshot 逻辑随 context_manager 瘦身一起删除 |

---

## Task 1: CSV_CONFIG 注册层

**Files:**
- Modify: `webnovel-writer/scripts/reference_search.py:90-191`
- Create: `webnovel-writer/scripts/data_modules/tests/test_csv_config.py`
- Modify: `webnovel-writer/scripts/tests/test_reference_search.py`

- [ ] **Step 1: 在 `reference_search.py` 新增 `CSV_CONFIG` dict**

在 `_TOKEN_SPLIT_RE` 定义之前（约第 89 行），插入 `CSV_CONFIG`：

```python
# ---------------------------------------------------------------------------
# Per-table configuration
# ---------------------------------------------------------------------------

CSV_CONFIG: Dict[str, Dict[str, Any]] = {
    "命名规则": {
        "file": "命名规则.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "命名对象", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "base",
    },
    "场景写法": {
        "file": "场景写法.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "模式名称", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "base",
    },
    "写作技法": {
        "file": "写作技法.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "技法名称", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "base",
    },
    "桥段套路": {
        "file": "桥段套路.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "桥段名称", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "dynamic",
    },
    "爽点与节奏": {
        "file": "爽点与节奏.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "节奏类型", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "dynamic",
    },
    "人设与关系": {
        "file": "人设与关系.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "人设类型", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "base",
    },
    "金手指与设定": {
        "file": "金手指与设定.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "设定类型", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "base",
    },
    "题材与调性推理": {
        "file": "题材与调性推理.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "题材别名": 3},
        "output_cols": ["编号", "题材/流派", "核心调性", "推荐基础检索表", "推荐动态检索表"],
        "poison_col": "毒点",
        "role": "route",
    },
    "裁决规则": {
        "file": "裁决规则.csv",
        "search_cols": {"题材": 4},
        "output_cols": [
            "题材", "风格优先级", "爽点优先级", "节奏默认策略",
            "毒点权重", "冲突裁决", "contract注入层", "反模式",
        ],
        "poison_col": "",
        "role": "reasoning",
    },
}
```

- [ ] **Step 2: 改造 `_build_doc_terms()` 使用 per-table `search_cols`**

把旧的 `_SEARCH_FIELD_WEIGHTS` 全局 dict 替换为 per-table 参数：

```python
# 删除旧的全局常量
# _SEARCH_FIELD_WEIGHTS = { ... }  # 删除

# 保留作为默认 fallback
_DEFAULT_SEARCH_WEIGHTS: Dict[str, int] = {
    "意图与同义词": 4,
    "关键词": 3,
    "核心摘要": 2,
    "详细展开": 1,
}


def _build_doc_terms(row: Dict[str, str], search_weights: Dict[str, int] | None = None) -> List[str]:
    """Build weighted BM25 terms from the configured search fields."""
    weights = search_weights or _DEFAULT_SEARCH_WEIGHTS
    terms: List[str] = []
    for field, weight in weights.items():
        field_terms = _tokenize(row.get(field, ""))
        if not field_terms:
            continue
        terms.extend(field_terms * weight)
    return terms
```

- [ ] **Step 3: 改造 `search()` 从 `CSV_CONFIG` 读取配置**

在 `search()` 函数里，根据 `table` 参数查 `CSV_CONFIG`：

```python
def search(
    csv_dir: Path,
    skill: str,
    query: str,
    table: Optional[str] = None,
    genre: Optional[str] = None,
    max_results: int = 5,
) -> Dict[str, Any]:
    # ... (error check 不变)

    tables = load_tables(csv_dir, table=table)
    if not tables:
        # ... (不变)

    # 按表查 search_cols
    table_config = CSV_CONFIG.get(table) if table else None
    search_weights = (
        dict(table_config["search_cols"]) if table_config else None
    )

    # 1) Collect filtered rows
    candidates: List[tuple] = []
    for tbl_name, rows in tables.items():
        for row in rows:
            if _skill_matches(row, skill) and _genre_matches(row, genre):
                candidates.append((tbl_name, row))

    if not candidates:
        # ... (不变)

    # 2) Tokenize - 对每条用其所在表的 search_cols
    query_terms = _tokenize(query)
    doc_terms_list = []
    for tbl_name, row in candidates:
        tbl_cfg = CSV_CONFIG.get(tbl_name)
        weights = dict(tbl_cfg["search_cols"]) if tbl_cfg else search_weights
        doc_terms_list.append(_build_doc_terms(row, weights))

    # 3-4) 不变 ...
```

- [ ] **Step 4: 删除 `_SEARCH_FIELD_WEIGHTS` 和 `_CONTENT_COLUMNS`**

删除第 90-95 行的 `_SEARCH_FIELD_WEIGHTS` 和第 180-190 行的 `_CONTENT_COLUMNS`。

`_build_summary()` 改为：如果有 `CSV_CONFIG` 里的 `output_cols`，就按那个顺序取字段；否则用原来的 fallback 逻辑。

```python
def _build_summary(row: Dict[str, str], table_name: str | None = None) -> str:
    core_summary = row.get("核心摘要", "").strip()
    if core_summary:
        return core_summary

    # 优先用 CSV_CONFIG 的 output_cols
    if table_name and table_name in CSV_CONFIG:
        cols = CSV_CONFIG[table_name]["output_cols"]
    else:
        cols = [
            "技法名称", "桥段名称", "人设类型", "节奏类型", "设定类型",
            "规则", "说明", "模式名称", "命名对象", "场景类型",
        ]

    parts: List[str] = []
    for col in cols:
        val = row.get(col, "").strip()
        if val and col not in ("编号", "大模型指令", "详细展开", "核心摘要"):
            parts.append(val)
    if parts:
        return "；".join(parts)
    return row.get("详细展开", "").strip()
```

- [ ] **Step 5: 创建 CSV_CONFIG 对齐校验测试**

```python
# webnovel-writer/scripts/data_modules/tests/test_csv_config.py
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CSV_CONFIG 与实际 CSV 表头对齐校验。"""
import csv
from pathlib import Path

import pytest

# reference_search.py 在 scripts/ 下，需要加 sys.path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from reference_search import CSV_CONFIG

CSV_DIR = Path(__file__).resolve().parent.parent.parent.parent / "references" / "csv"


@pytest.mark.parametrize("table_name,config", list(CSV_CONFIG.items()))
def test_csv_config_columns_exist_in_csv_header(table_name: str, config: dict):
    """CSV_CONFIG 里声明的所有列名都必须在 CSV 文件头中找到。"""
    csv_path = CSV_DIR / config["file"]
    if not csv_path.exists():
        pytest.skip(f"{config['file']} not yet created")

    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        headers = set(reader.fieldnames or [])

    all_cols = set()
    for col in config.get("search_cols", {}):
        all_cols.add(col)
    for col in config.get("output_cols", []):
        all_cols.add(col)
    poison = config.get("poison_col", "")
    if poison:
        all_cols.add(poison)

    missing = all_cols - headers
    assert not missing, f"表 {table_name} 缺少列: {missing}"


def test_csv_config_file_field_matches_filename():
    """CSV_CONFIG 的 file 字段必须与 key + '.csv' 对应。"""
    for name, config in CSV_CONFIG.items():
        assert config["file"] == f"{name}.csv", f"{name}: file 应为 '{name}.csv'，实际为 '{config['file']}'"
```

- [ ] **Step 6: 运行测试验证**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_csv_config.py -v`

预期：`裁决规则` 那条会 skip（文件还没创建），其余表全 pass。

- [ ] **Step 7: 补充 per-table 检索测试**

在 `webnovel-writer/scripts/tests/test_reference_search.py` 末尾新增：

```python
class TestPerTableSearchCols:
    """CSV_CONFIG per-table search_cols 测试。"""

    def test_different_tables_use_different_search_weights(self):
        """确认不同表用不同的 search_cols 做检索。"""
        # 命名规则和场景写法都应返回结果，但用各自表的 search_cols
        out1 = run_search("--skill", "write", "--table", "命名规则", "--query", "角色命名")
        out2 = run_search("--skill", "write", "--table", "场景写法", "--query", "战斗描写")
        assert out1["status"] == "success"
        assert out2["status"] == "success"
        assert out1["data"]["total"] >= 1
        assert out2["data"]["total"] >= 1
```

- [ ] **Step 8: 运行全量 reference_search 测试**

Run: `cd webnovel-writer && python -m pytest scripts/tests/test_reference_search.py -v`

预期：全部 PASS。

- [ ] **Step 9: Commit**

```bash
git add webnovel-writer/scripts/reference_search.py webnovel-writer/scripts/data_modules/tests/test_csv_config.py webnovel-writer/scripts/tests/test_reference_search.py
git commit -m "feat: introduce per-table CSV_CONFIG in reference_search"
```

---

## Task 2: CSV 毒点列统一

**Files:**
- Modify: `webnovel-writer/references/csv/场景写法.csv` (header rename)
- Modify: `webnovel-writer/references/csv/写作技法.csv` (header rename)
- Modify: `webnovel-writer/references/csv/爽点与节奏.csv` (header rename)
- Modify: `webnovel-writer/references/csv/人设与关系.csv` (header rename)
- Modify: `webnovel-writer/references/csv/桥段套路.csv` (header rename)
- Modify: `webnovel-writer/references/csv/题材与调性推理.csv` (header rename)
- Modify: `webnovel-writer/scripts/data_modules/story_system_engine.py:15-22`

- [ ] **Step 1: 统计当前各表的毒点列名**

当前列名映射：
- `场景写法.csv` → `反面写法`
- `写作技法.csv` → `常见误区`
- `爽点与节奏.csv` → `常见崩盘误区`
- `人设与关系.csv` → `忌讳写法`
- `桥段套路.csv` → 有 `忌讳写法` 列
- `题材与调性推理.csv` → `强制禁忌/毒点`
- `命名规则.csv` → 无毒点列（header 里有 `反例`，保留不动，新增 `毒点` 列）
- `金手指与设定.csv` → 无毒点列（新增 `毒点` 列）

- [ ] **Step 2: 批量 rename CSV 列头**

用脚本执行（一次性，不入库）：

```python
# 在 bash 里直接执行
python3 -c "
import csv, sys
from pathlib import Path

csv_dir = Path('webnovel-writer/references/csv')

renames = {
    '场景写法.csv': {'反面写法': '毒点'},
    '写作技法.csv': {'常见误区': '毒点'},
    '爽点与节奏.csv': {'常见崩盘误区': '毒点'},
    '人设与关系.csv': {'忌讳写法': '毒点'},
    '桥段套路.csv': {'忌讳写法': '毒点'},
    '题材与调性推理.csv': {'强制禁忌/毒点': '毒点'},
}

for filename, mapping in renames.items():
    path = csv_dir / filename
    with open(path, 'r', encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        old_fields = list(reader.fieldnames)

    new_fields = [mapping.get(f, f) for f in old_fields]

    new_rows = []
    for row in rows:
        new_row = {}
        for old_f, new_f in zip(old_fields, new_fields):
            new_row[new_f] = row.get(old_f, '')
        new_rows.append(new_row)

    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=new_fields)
        writer.writeheader()
        writer.writerows(new_rows)

print('Done')
"
```

- [ ] **Step 3: 给 `命名规则.csv` 和 `金手指与设定.csv` 新增空 `毒点` 列**

```python
python3 -c "
import csv
from pathlib import Path

csv_dir = Path('webnovel-writer/references/csv')

for filename in ['命名规则.csv', '金手指与设定.csv']:
    path = csv_dir / filename
    with open(path, 'r', encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fields = list(reader.fieldnames)

    if '毒点' not in fields:
        fields.append('毒点')
        for row in rows:
            row['毒点'] = ''

    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

print('Done')
"
```

- [ ] **Step 4: 更新 `story_system_engine.py` 的 `ANTI_PATTERN_SOURCE_FIELDS`**

把第 15-22 行的旧映射：

```python
ANTI_PATTERN_SOURCE_FIELDS = {
    "场景写法": ["反面写法"],
    "写作技法": ["常见误区"],
    "爽点与节奏": ["常见崩盘误区"],
    "人设与关系": ["忌讳写法"],
    "桥段套路": ["忌讳写法"],
    "题材与调性推理": ["强制禁忌/毒点"],
}
```

统一改为：

```python
ANTI_PATTERN_SOURCE_FIELDS = {
    "场景写法": ["毒点"],
    "写作技法": ["毒点"],
    "爽点与节奏": ["毒点"],
    "人设与关系": ["毒点"],
    "桥段套路": ["毒点"],
    "题材与调性推理": ["毒点"],
    "命名规则": ["毒点"],
    "金手指与设定": ["毒点"],
}
```

- [ ] **Step 5: 运行测试**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_csv_config.py scripts/data_modules/tests/test_story_system_engine.py scripts/tests/test_reference_search.py -v`

预期：test_story_system_engine 会因 fixture CSV 里用旧列名而失败。

- [ ] **Step 6: 修复 `test_story_system_engine.py` fixture 列名**

把 fixture CSV 里的 `忌讳写法` 和 `常见崩盘误区` 改为 `毒点`，`强制禁忌/毒点` 也改为 `毒点`。

fixture 第 53 行的 `桥段套路.csv` headers 改为：
```python
["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要", "桥段名称", "毒点"],
```
对应行数据 key `忌讳写法` 改为 `毒点`。

fixture 第 71 行的 `爽点与节奏.csv` headers 改为：
```python
["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要", "毒点", "节奏类型"],
```
对应行数据 key `常见崩盘误区` 改为 `毒点`。

fixture 第 26 行的 `题材与调性推理.csv` headers 里 `强制禁忌/毒点` 改为 `毒点`，对应行数据 key 也改为 `毒点`。

- [ ] **Step 7: 运行测试确认全 PASS**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_story_system_engine.py scripts/data_modules/tests/test_csv_config.py -v`

预期：全部 PASS。

- [ ] **Step 8: Commit**

```bash
git add webnovel-writer/references/csv/*.csv webnovel-writer/scripts/data_modules/story_system_engine.py webnovel-writer/scripts/data_modules/tests/test_story_system_engine.py
git commit -m "refactor: unify poison column name to 毒点 across all CSV tables"
```

---

## Task 3: 新建裁决规则表

**Files:**
- Create: `webnovel-writer/references/csv/裁决规则.csv`

- [ ] **Step 1: 创建裁决规则 CSV 文件**

```csv
编号,适用技能,分类,层级,关键词,意图与同义词,适用题材,大模型指令,核心摘要,详细展开,题材,风格优先级,爽点优先级,节奏默认策略,毒点权重,冲突裁决,contract注入层,反模式
RS-001,write|plan,裁决,推理层,西方奇幻|奇幻,西方奇幻怎么写,西方奇幻,按冲突裁决排序命中条目,西方奇幻裁决规则,,西方奇幻,史诗感 > 冷硬算计 > 日常轻松,实力碾压 > 逆境翻盘 > 智谋博弈,快推慢收 对峙段拉长 过渡段压短,圣母病 > 情绪标签化 > 逻辑断裂,爽点与节奏 > 场景写法 > 写作技法,CHAPTER_BRIEF.writing_guidance,情绪标签化|角色行为无逻辑|战斗无代价
RS-002,write|plan,裁决,推理层,东方仙侠|仙侠,仙侠怎么写,东方仙侠,按冲突裁决排序命中条目,东方仙侠裁决规则,,东方仙侠,冷硬算计 > 超然物外 > 热血冲突,境界碾压 > 底牌揭晓 > 因果兑现,慢蓄快爆 修炼段精简 斗法段拉满,修炼水字数 > 圣母病 > 逻辑断裂,爽点与节奏 > 桥段套路 > 场景写法,CHAPTER_BRIEF.writing_guidance,修炼变流水账|境界突破无代价|感悟靠顿悟标签
RS-003,write|plan,裁决,推理层,科幻末世|末世|科幻,科幻末世怎么写,科幻末世,按冲突裁决排序命中条目,科幻末世裁决规则,,科幻末世,高压克制 > 冷硬算计 > 绝境反击,绝境生存 > 资源碾压 > 智谋博弈,紧凑推进 危机不断 喘息极短,主角无敌 > 科技无代价 > 末世无压迫感,场景写法 > 爽点与节奏 > 写作技法,CHAPTER_BRIEF.writing_guidance,末世没有生存压力|科技万能|角色行为无逻辑
RS-004,write|plan,裁决,推理层,都市日常|都市,都市日常怎么写,都市日常,按冲突裁决排序命中条目,都市日常裁决规则,,都市日常,日常轻松 > 温情治愈 > 微妙张力,情感共鸣 > 生活逆袭 > 社交碾压,慢节奏 情感铺垫长 冲突柔和,假大空说教 > 情绪标签化 > 逻辑断裂,写作技法 > 人设与关系 > 场景写法,CHAPTER_BRIEF.writing_guidance,情感靠标签|日常无冲突|角色千人一面
RS-005,write|plan,裁决,推理层,都市修真|修真|现代修真,都市修真怎么写,都市修真,按冲突裁决排序命中条目,都市修真裁决规则,,都市修真,隐秘低调 > 冷硬算计 > 热血爆发,身份反差 > 境界碾压 > 底牌揭晓,快慢交替 日常短 修真爆发长,修真体系与现代割裂 > 圣母病 > 装逼无代价,爽点与节奏 > 场景写法 > 桥段套路,CHAPTER_BRIEF.writing_guidance,修真体系照搬古代|现代元素没有影响|身份暴露无后果
RS-006,write|plan,裁决,推理层,都市高武|高武|都市异能,都市高武怎么写,都市高武,按冲突裁决排序命中条目,都市高武裁决规则,,都市高武,热血冲突 > 冷硬算计 > 力量美学,实力碾压 > 以弱胜强 > 排名跃升,快节奏 战斗密集 过渡极短,战力崩盘 > 圣母病 > 无脑开挂,爽点与节奏 > 场景写法 > 桥段套路,CHAPTER_BRIEF.writing_guidance,战力体系自相矛盾|升级无代价|打斗无策略
RS-007,write|plan,裁决,推理层,历史古代|历史|古代,历史古代怎么写,历史古代,按冲突裁决排序命中条目,历史古代裁决规则,,历史古代,沉稳厚重 > 权谋算计 > 家国情怀,权谋碾压 > 历史转折 > 身份反转,慢铺快收 权谋段拉长 战争段紧凑,现代价值观强加古人 > 逻辑断裂 > 历史常识错误,写作技法 > 人设与关系 > 场景写法,CHAPTER_BRIEF.writing_guidance,用现代口语写古代|权谋无逻辑|历史事件随意篡改
```

- [ ] **Step 2: 运行 CSV_CONFIG 校验确认新表列头对齐**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_csv_config.py -v`

预期：`裁决规则` 现在有文件了，应该 PASS。

- [ ] **Step 3: Commit**

```bash
git add webnovel-writer/references/csv/裁决规则.csv
git commit -m "feat: add 裁决规则.csv reasoning table for 7 genres"
```

---

## Task 4: engine 接入裁决表

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/story_system_engine.py`
- Create: `webnovel-writer/scripts/data_modules/tests/test_reasoning_engine.py`
- Modify: `webnovel-writer/scripts/data_modules/tests/test_story_system_engine.py`

- [ ] **Step 1: 写裁决层测试**

```python
# webnovel-writer/scripts/data_modules/tests/test_reasoning_engine.py
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""裁决层集成测试。"""
import csv

from data_modules.story_system_engine import StorySystemEngine


def _write_csv(path, headers, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


ROUTE_HEADERS = [
    "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
    "大模型指令", "核心摘要", "详细展开", "题材/流派", "题材别名", "核心调性",
    "节奏策略", "毒点", "推荐基础检索表", "推荐动态检索表", "默认查询词",
]

REASONING_HEADERS = [
    "编号", "适用技能", "分类", "层级", "关键词", "意图与同义词", "适用题材",
    "大模型指令", "核心摘要", "详细展开",
    "题材", "风格优先级", "爽点优先级", "节奏默认策略",
    "毒点权重", "冲突裁决", "contract注入层", "反模式",
]


def _setup_csvs(csv_dir):
    _write_csv(csv_dir / "题材与调性推理.csv", ROUTE_HEADERS, [{
        "编号": "GR-001", "适用技能": "write|plan", "分类": "题材路由",
        "层级": "知识补充", "关键词": "玄幻", "意图与同义词": "玄幻|仙侠",
        "适用题材": "玄幻", "大模型指令": "", "核心摘要": "", "详细展开": "",
        "题材/流派": "玄幻", "题材别名": "玄幻", "核心调性": "热血冲突",
        "节奏策略": "快推慢收", "毒点": "圣母病",
        "推荐基础检索表": "命名规则|人设与关系",
        "推荐动态检索表": "桥段套路|爽点与节奏",
        "默认查询词": "玄幻",
    }])

    _write_csv(csv_dir / "裁决规则.csv", REASONING_HEADERS, [{
        "编号": "RS-001", "适用技能": "write|plan", "分类": "裁决",
        "层级": "推理层", "关键词": "玄幻", "意图与同义词": "玄幻",
        "适用题材": "玄幻", "大模型指令": "", "核心摘要": "", "详细展开": "",
        "题材": "玄幻",
        "风格优先级": "热血冲突 > 冷硬算计",
        "爽点优先级": "实力碾压 > 逆境翻盘",
        "节奏默认策略": "快推慢收",
        "毒点权重": "圣母病 > 情绪标签化",
        "冲突裁决": "爽点与节奏 > 场景写法 > 写作技法",
        "contract注入层": "CHAPTER_BRIEF.writing_guidance",
        "反模式": "情绪标签化|战斗无代价",
    }])

    _write_csv(csv_dir / "桥段套路.csv",
        ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要", "桥段名称", "毒点"],
        [{"编号": "TR-001", "适用技能": "write", "分类": "桥段", "层级": "知识补充",
          "关键词": "退婚", "适用题材": "玄幻", "核心摘要": "退婚反击",
          "桥段名称": "退婚反击", "毒点": "配角代打"}])

    _write_csv(csv_dir / "爽点与节奏.csv",
        ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要", "毒点", "节奏类型"],
        [{"编号": "PA-001", "适用技能": "write", "分类": "节奏", "层级": "知识补充",
          "关键词": "打脸", "适用题材": "玄幻", "核心摘要": "兑现必须补刀",
          "毒点": "打脸软收尾", "节奏类型": "爆发期"}])


def test_build_with_reasoning_includes_reasoning_rule_in_source_trace(tmp_path):
    csv_dir = tmp_path / "csv"
    csv_dir.mkdir()
    _setup_csvs(csv_dir)

    engine = StorySystemEngine(csv_dir=csv_dir)
    contract = engine.build(query="玄幻", genre=None, chapter=5)

    traces = contract["master_setting"]["source_trace"]
    reasoning_traces = [t for t in traces if t.get("reasoning_rule")]
    assert len(reasoning_traces) >= 1
    assert reasoning_traces[0]["reasoning_rule"] == "玄幻"


def test_reasoning_anti_patterns_sorted_by_weight(tmp_path):
    csv_dir = tmp_path / "csv"
    csv_dir.mkdir()
    _setup_csvs(csv_dir)

    engine = StorySystemEngine(csv_dir=csv_dir)
    contract = engine.build(query="玄幻", genre=None, chapter=5)

    anti = contract["anti_patterns"]
    assert len(anti) >= 1


def test_reasoning_not_found_falls_back_gracefully(tmp_path):
    csv_dir = tmp_path / "csv"
    csv_dir.mkdir()
    _setup_csvs(csv_dir)

    engine = StorySystemEngine(csv_dir=csv_dir)
    contract = engine.build(query="末日生存", genre="末日", chapter=1)

    # 没有裁决规则也不应报错
    assert "master_setting" in contract
    assert "anti_patterns" in contract
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_reasoning_engine.py -v`

预期：FAIL，因为 `_load_reasoning` 等方法还不存在。

- [ ] **Step 3: 在 `story_system_engine.py` 新增裁决方法**

在 `StorySystemEngine` 类末尾新增：

```python
def _load_reasoning(self, genre: str) -> Dict[str, Any]:
    """从裁决表按题材查一行，返回裁决规则 dict。"""
    rows = self._load_csv_rows("裁决规则")
    genre_text = self._normalize_text(genre)
    for row in rows:
        row_genre = self._normalize_text(row.get("题材", ""))
        if row_genre == genre_text:
            return row
        aliases = self._split_multi_value(row.get("关键词")) + self._split_multi_value(row.get("意图与同义词"))
        if any(self._normalize_text(a) == genre_text for a in aliases):
            return row
    return {}

def _apply_reasoning(
    self,
    reasoning: Dict[str, Any],
    base_context: List[Dict[str, Any]],
    dynamic_context: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """用冲突裁决字段对命中条目做优先级排序。"""
    if not reasoning:
        return base_context + dynamic_context

    priority_order = [
        t.strip() for t in str(reasoning.get("冲突裁决", "")).split(">") if t.strip()
    ]
    priority_map = {name: idx for idx, name in enumerate(priority_order)}

    all_rows = base_context + dynamic_context
    for row in all_rows:
        table_name = str(row.get("_table", "")).strip()
        row["_priority_rank"] = priority_map.get(table_name, len(priority_order))
        row["_reasoning_rule"] = str(reasoning.get("题材", "")).strip()

    all_rows.sort(key=lambda r: r.get("_priority_rank", 999))
    return all_rows

def _rank_anti_patterns(
    self,
    reasoning: Dict[str, Any],
    anti_patterns: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """用毒点权重字段对毒点排序。"""
    if not reasoning:
        return anti_patterns

    weight_order = [
        t.strip() for t in str(reasoning.get("毒点权重", "")).split(">") if t.strip()
    ]

    def sort_key(item):
        text = str(item.get("text", "")).strip()
        for idx, keyword in enumerate(weight_order):
            if keyword in text:
                return idx
        return len(weight_order)

    anti_patterns.sort(key=sort_key)

    # 追加裁决表自带的反模式
    for text in self._split_multi_value(reasoning.get("反模式")):
        anti_patterns.append({
            "text": text,
            "source_table": "裁决规则",
            "source_id": reasoning.get("编号", ""),
        })

    return anti_patterns
```

- [ ] **Step 4: 改造 `build()` 方法接入裁决层**

把 `build()` 方法（第 29-90 行）改为：

```python
def build(self, query: str, genre: Optional[str], chapter: Optional[int]) -> Dict[str, Any]:
    route = self._route(query=query, genre=genre)
    search_query = self._expand_query(query, route.get("default_query", ""))
    base_context = self._collect_tables(
        search_query,
        route["recommended_base_tables"],
        genre=route["genre_filter"],
        top_k=1,
    )
    dynamic_context = self._collect_tables(
        search_query,
        route["recommended_dynamic_tables"],
        genre=route["genre_filter"],
        top_k=2,
    )

    # --- 裁决层 ---
    primary_genre = str(
        route.get("meta", {}).get("primary_genre", "") or genre or ""
    ).strip()
    reasoning = self._load_reasoning(primary_genre)
    ranked = self._apply_reasoning(reasoning, base_context, dynamic_context)

    source_trace = route["source_trace"] + self._build_source_trace_with_reasoning(ranked, reasoning)

    raw_anti = merge_anti_patterns(
        route["route_anti_patterns"],
        self._extract_anti_patterns(base_context),
        self._extract_anti_patterns(dynamic_context),
    )
    anti_patterns = self._rank_anti_patterns(reasoning, raw_anti)

    return {
        "meta": {"query": query, "chapter": chapter, "explicit_genre": genre or ""},
        "master_setting": {
            "meta": {
                "schema_version": "story-system/v1",
                "contract_type": "MASTER_SETTING",
                "generator_version": "phase1",
                "query": query,
            },
            "route": route["meta"],
            "master_constraints": {
                "core_tone": route["core_tone"],
                "pacing_strategy": route["pacing_strategy"],
            },
            "base_context": [r for r in ranked if r.get("_priority_rank", 999) < 999],
            "source_trace": source_trace,
            "override_policy": {
                "locked": ["route.primary_genre", "master_constraints.core_tone"],
                "append_only": ["anti_patterns"],
                "override_allowed": [],
            },
        },
        "chapter_brief": (
            {
                "meta": {
                    "schema_version": "story-system/v1",
                    "contract_type": "CHAPTER_BRIEF",
                    "generator_version": "phase1",
                    "chapter": chapter,
                },
                "override_allowed": {
                    "chapter_focus": self._suggest_chapter_focus(query, dynamic_context),
                },
                "dynamic_context": ranked,
                "source_trace": source_trace,
                "reasoning": {
                    "genre": reasoning.get("题材", ""),
                    "inject_target": reasoning.get("contract注入层", ""),
                    "style_priority": reasoning.get("风格优先级", ""),
                    "pacing_strategy": reasoning.get("节奏默认策略", ""),
                } if reasoning else {},
            }
            if chapter is not None
            else None
        ),
        "anti_patterns": anti_patterns,
    }
```

- [ ] **Step 5: 新增 `_build_source_trace_with_reasoning` 方法**

```python
def _build_source_trace_with_reasoning(
    self, ranked: List[Dict[str, Any]], reasoning: Dict[str, Any]
) -> List[Dict[str, Any]]:
    trace: List[Dict[str, Any]] = []
    reasoning_rule = str(reasoning.get("题材", "")).strip() if reasoning else ""
    for row in ranked:
        trace.append({
            "table": row.get("_table", ""),
            "id": row.get("编号", ""),
            "summary": row.get("核心摘要", ""),
            "reasoning_rule": row.get("_reasoning_rule", reasoning_rule),
            "priority_rank": row.get("_priority_rank", 999),
            "inject_target": str(reasoning.get("contract注入层", "")).strip() if reasoning else "",
        })
    return trace
```

- [ ] **Step 6: 运行裁决层测试**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_reasoning_engine.py -v`

预期：全部 PASS。

- [ ] **Step 7: 运行现有 engine 测试确认不破坏**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_story_system_engine.py -v`

预期：全部 PASS（无裁决表时 graceful fallback）。

- [ ] **Step 8: Commit**

```bash
git add webnovel-writer/scripts/data_modules/story_system_engine.py webnovel-writer/scripts/data_modules/tests/test_reasoning_engine.py
git commit -m "feat: integrate reasoning table into story_system_engine build pipeline"
```

---

## Task 5: context_manager 瘦身

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/context_manager.py`
- Delete: `webnovel-writer/scripts/data_modules/snapshot_manager.py`
- Modify: `webnovel-writer/scripts/data_modules/tests/test_context_manager.py`

- [ ] **Step 1: 从 `context_manager.py` 删除 snapshot 相关代码**

1. 删除 import：`from .snapshot_manager import SnapshotManager, SnapshotVersionMismatch`（第 33 行）
2. 删除 `__init__` 中 `self.snapshot_manager` 赋值（第 101 行）
3. 删除 `_is_snapshot_compatible` 方法（第 105-146 行）
4. 删除 `build_context` 中 snapshot 加载和保存逻辑（第 162-169 行和第 176-181 行）
5. 删除 `_story_contract_signature` 方法（第 794-817 行）
6. 删除 `_payload_signature` 方法（第 819-823 行）
7. 删除 `build_context` 的 `use_snapshot` 和 `save_snapshot` 参数

- [ ] **Step 2: 简化 `build_context` 为纯 JSON 返回**

改造后的 `build_context`：

```python
def build_context(
    self,
    chapter: int,
    template: str | None = None,
    max_chars: Optional[int] = None,
) -> Dict[str, Any]:
    template = template or self.DEFAULT_TEMPLATE
    self._active_template = template
    if template not in self.TEMPLATE_WEIGHTS:
        template = self.DEFAULT_TEMPLATE
        self._active_template = template

    pack = self._build_pack(chapter)
    if getattr(self.config, "context_ranker_enabled", True):
        pack = self.context_ranker.rank_pack(pack, chapter)

    return self._assemble_json_payload(pack, template=template, max_chars=max_chars)
```

- [ ] **Step 3: 把 `assemble_context` 重写为 `_assemble_json_payload`**

直接返回 dict，不做 text 渲染：

```python
def _assemble_json_payload(
    self,
    pack: Dict[str, Any],
    template: str = DEFAULT_TEMPLATE,
    max_chars: Optional[int] = None,
) -> Dict[str, Any]:
    chapter = int((pack.get("meta") or {}).get("chapter") or 0)
    weights = self._resolve_template_weights(template=template, chapter=chapter)

    payload: Dict[str, Any] = {
        "meta": {
            **(pack.get("meta") or {}),
            "context_contract_version": "v3",
        },
    }

    for section_name in self.SECTION_ORDER:
        if section_name in pack and section_name != "global":
            content = pack[section_name]
            weight = weights.get(section_name, 0.0)
            if weight > 0 or section_name in self.EXTRA_SECTIONS:
                payload[section_name] = content

    if chapter > 0:
        payload["meta"]["context_weight_stage"] = self._resolve_context_stage(chapter)

    return payload
```

- [ ] **Step 4: 删除 `_compact_json_text` 方法**

删除第 749-764 行。

- [ ] **Step 5: 删除 `assemble_context` 旧方法**

删除第 185-217 行的 `assemble_context`。

- [ ] **Step 6: 更新 `__init__` 签名**

```python
def __init__(self, config=None):
    self.config = config or get_config()
    self.index_manager = IndexManager(self.config)
    self.context_ranker = ContextRanker(self.config)
```

- [ ] **Step 7: 删除 `snapshot_manager.py`**

```bash
git rm webnovel-writer/scripts/data_modules/snapshot_manager.py
```

- [ ] **Step 8: 更新 `extract_chapter_context.py` 的 `_load_contract_context`**

`_load_contract_context`（第 294-325 行）改为：

```python
def _load_contract_context(project_root: Path, chapter_num: int) -> Dict[str, Any]:
    """Build context via ContextManager and return payload directly."""
    _ensure_scripts_path()
    from data_modules.config import DataModulesConfig
    from data_modules.context_manager import ContextManager

    config = DataModulesConfig.from_project_root(project_root)
    manager = ContextManager(config)
    payload = manager.build_context(chapter=chapter_num, template="plot")

    return {
        "context_contract_version": (payload.get("meta") or {}).get("context_contract_version"),
        "context_weight_stage": (payload.get("meta") or {}).get("context_weight_stage"),
        "story_contract": payload.get("story_contract", {}),
        "runtime_status": payload.get("runtime_status", {}),
        "latest_commit": payload.get("latest_commit", {}),
        "prewrite_validation": payload.get("prewrite_validation", {}),
        "reader_signal": payload.get("reader_signal", {}),
        "genre_profile": payload.get("genre_profile", {}),
        "writing_guidance": payload.get("writing_guidance", {}),
        "plot_structure": payload.get("plot_structure", {}),
        "long_term_memory": payload.get("long_term_memory", {}),
        "scene": payload.get("scene", {}),
        "core": payload.get("core", {}),
    }
```

- [ ] **Step 9: 把 `_render_text()` 改为纯 JSON 序列化**

当前 `_render_text()`（第 364-601 行）是一个 240 行的审计式文本渲染函数。按 spec 终局，text 渲染不再由代码层负责——context-agent 拿 JSON payload 按示例写任务书。

把整个 `_render_text()` 替换为：

```python
def _render_text(payload: Dict[str, Any]) -> str:
    """JSON 序列化输出，text 渲染由 context-agent 负责。"""
    return json.dumps(payload, ensure_ascii=False, indent=2)
```

这意味着 `--format text` 和 `--format json` 现在输出相同内容。如果后续要区分，可以在 context-agent 侧处理，但代码层不再做 markdown 拼接。

- [ ] **Step 10: 修复受影响的测试**

在 `test_context_manager.py` 中：
- 删除所有 `snapshot_manager` 相关的 mock 和 fixture
- 删除 snapshot 相关的测试用例
- 更新 `build_context` 调用移除 `use_snapshot` / `save_snapshot` 参数
- 更新断言适配新的 payload 结构（直接 `payload["story_contract"]` 而不是 `payload["sections"]["story_contract"]["content"]`）

在 `test_extract_chapter_context.py` 中：
- 更新任何依赖旧 markdown 渲染输出的断言（如 `"## 本章大纲"` 等 markdown 标题检查改为 JSON key 检查）

- [ ] **Step 11: 运行测试**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_context_manager.py scripts/data_modules/tests/test_extract_chapter_context.py -v`

预期：全部 PASS。

- [ ] **Step 12: 确认行数**

Run: `wc -l webnovel-writer/scripts/data_modules/context_manager.py`

预期：400 行以下。

- [ ] **Step 13: Commit**

```bash
git add webnovel-writer/scripts/data_modules/context_manager.py webnovel-writer/scripts/extract_chapter_context.py webnovel-writer/scripts/data_modules/tests/test_context_manager.py
git rm webnovel-writer/scripts/data_modules/snapshot_manager.py
git commit -m "refactor: slim context_manager to pure JSON assembler, remove snapshot"
```

---

## Task 6: 旧散写路径清理

**Files:**
- Modify: `webnovel-writer/skills/webnovel-write/SKILL.md:184,254,323`
- Modify: `webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py`

- [ ] **Step 1: 删除 SKILL.md 中 Step 2 的 `set-chapter-status`**

删除第 182-184 行：

```markdown
状态推进：

```bash
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" state set-chapter-status --chapter {chapter_num} --status chapter_drafted
```
```

- [ ] **Step 2: 删除 SKILL.md 中 Step 4 的 `set-chapter-status`**

删除第 250-254 行的 `状态推进（--minimal 除外）：` 段和对应的 bash 块。

- [ ] **Step 3: 删除 SKILL.md 中 Step 5 末尾的 `set-chapter-status`**

删除第 320-323 行的状态推进 bash 块。Step 5 的状态推进现在由 `state_projection_writer.py` 在 commit accepted 时自动完成。

在 Step 5.3 验证投影状态段落中补充说明：

```markdown
**chapter_status 推进**：
- accepted commit → `state_projection_writer` 自动推进到 `chapter_committed`
- rejected commit → `state_projection_writer` 自动推进到 `chapter_rejected`
- 不再由 skill 手动调用 `set-chapter-status`
```

- [ ] **Step 4: 更新充分性闸门**

把第 338-346 行的闸门条件中：
- 删除 "2. `chapter_status` 已推进到 `chapter_drafted`（Step 2 完成）"
- 把 "5. ... `chapter_status` 已推进到 `chapter_reviewed`" 中状态检查改为仅由投影确认
- 把 "6. ... `chapter_status` 已推进到 `chapter_committed`" 改为 "6. ... projection_status 四项全部 done/skipped"

改为：

```markdown
## 充分性闸门

未满足以下条件前，不得结束流程：

1. 章节正文文件存在且非空。
2. Step 3 已产出审查结果并落库（`--minimal` 除外）。
3. 若存在 `blocking=true` 的 issue，流程必须停在 Step 3。
4. Step 4 的 `anti_ai_force_check=pass`（`--minimal` 除外）。
5. Step 5 已生成 accepted `CHAPTER_COMMIT`，`projection_status` 四项全部为 `done` 或 `skipped`。
6. `chapter_status` 为 `chapter_committed`（由 projection writer 自动推进，不手动写入）。
7. 若启用观测，已读取最新 timing 记录并给出结论。
```

- [ ] **Step 5: 新增 prompt integrity 测试断言**

在 `test_prompt_integrity.py` 末尾新增：

```python
def test_no_direct_state_writes_in_write_skill():
    """webnovel-write SKILL.md 中不应有 set-chapter-status 调用（由 projection writer 统一推进）。"""
    text = (SKILLS_DIR / "webnovel-write" / "SKILL.md").read_text(encoding="utf-8")
    assert "state set-chapter-status" not in text, (
        "webnovel-write 中不应直接调用 state set-chapter-status，"
        "chapter_status 由 state_projection_writer 在 commit 时自动推进"
    )


def test_no_direct_state_writes_in_agents():
    """agents 目录中不应有直接写 state/index 的指令。"""
    for agent_file in AGENT_FILES:
        text = _read_text(agent_file)
        assert "state set-chapter-status" not in text, (
            f"{agent_file.name}: 不应直接调用 state set-chapter-status"
        )
```

- [ ] **Step 6: 运行测试**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_prompt_integrity.py -v`

预期：全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add webnovel-writer/skills/webnovel-write/SKILL.md webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py
git commit -m "refactor: remove direct set-chapter-status calls from write skill"
```

---

## Task 7: projection 层收束

**Files:**
- Modify: `webnovel-writer/scripts/data_modules/event_projection_router.py`
- Modify: `webnovel-writer/scripts/data_modules/state_projection_writer.py`
- Modify: `webnovel-writer/scripts/data_modules/chapter_commit_service.py`
- Modify: `webnovel-writer/scripts/data_modules/tests/test_event_projection_router.py`

- [ ] **Step 1: 写 router vector 路由测试**

在 `test_event_projection_router.py` 末尾新增：

```python
def test_router_maps_power_breakthrough_to_state_memory_vector():
    router = EventProjectionRouter()
    targets = router.route(
        {"event_type": "power_breakthrough", "subject": "xiaoyan", "payload": {}}
    )
    assert "vector" in targets
    assert "state" in targets
    assert "memory" in targets


def test_router_maps_relationship_changed_to_index_and_vector():
    router = EventProjectionRouter()
    targets = router.route(
        {"event_type": "relationship_changed", "subject": "xiaoyan", "payload": {}}
    )
    assert "index" in targets
    assert "vector" in targets


def test_required_writers_includes_vector_for_key_events():
    router = EventProjectionRouter()
    payload = {
        "meta": {"status": "accepted", "chapter": 5},
        "accepted_events": [
            {"event_type": "power_breakthrough", "subject": "xiaoyan", "payload": {}},
        ],
        "entity_deltas": [],
        "summary_text": "摘要",
    }
    writers = router.required_writers(payload)
    assert "vector" in writers
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_event_projection_router.py -v`

预期：新增的 3 个测试 FAIL。

- [ ] **Step 3: 更新 `EventProjectionRouter.TABLE`**

```python
class EventProjectionRouter:
    TABLE = {
        "character_state_changed": ["state", "memory", "vector"],
        "power_breakthrough": ["state", "memory", "vector"],
        "relationship_changed": ["index", "vector"],
        "world_rule_revealed": ["memory", "vector"],
        "world_rule_broken": ["memory", "vector"],
        "open_loop_created": ["memory"],
        "open_loop_closed": ["memory"],
        "promise_created": ["memory"],
        "promise_paid_off": ["memory"],
        "artifact_obtained": ["index", "vector"],
    }
```

- [ ] **Step 4: 确认 `state_projection_writer` 已处理 `chapter_status`**

当前 `state_projection_writer.py:34-35` 已有：

```python
if chapter > 0:
    chapter_status[str(chapter)] = "chapter_committed"
```

这已经满足 Section 6/7 的要求（accepted commit 时自动推进到 `chapter_committed`）。

确认 rejected commit 时不推进——当前第 15 行检查了 `status != "accepted"` 直接返回，不写状态。这是正确的。

但 spec 要求 rejected 推进到 `chapter_rejected`。在 `apply` 方法开头加 rejected 处理：

```python
def apply(self, commit_payload: dict) -> dict:
    chapter = int(commit_payload.get("meta", {}).get("chapter") or 0)
    status = commit_payload["meta"]["status"]

    if status == "rejected":
        if chapter > 0:
            state_path = self.project_root / ".webnovel" / "state.json"
            state = read_json_if_exists(state_path) or {}
            progress = state.setdefault("progress", {})
            chapter_status = progress.setdefault("chapter_status", {})
            chapter_status[str(chapter)] = "chapter_rejected"
            write_json(state_path, state)
        return {"applied": True, "writer": "state", "reason": "commit_rejected_status_updated"}

    # ... rest of accepted logic
```

- [ ] **Step 5: 确认 `chapter_commit_service.apply_projections` 的失败隔离**

当前第 115-119 行已有 try/except 隔离：

```python
try:
    result = writer.apply(payload)
    payload["projection_status"][name] = "done" if result.get("applied") else "skipped"
except Exception as exc:
    payload["projection_status"][name] = f"failed:{exc}"
```

并且第 120 行 `self.persist_commit(payload)` 在所有 writer 执行完后才写入——确保 `projection_status` 已更新。

这已满足 spec 要求。不需要额外改动。

- [ ] **Step 6: 运行测试**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_event_projection_router.py -v`

预期：全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add webnovel-writer/scripts/data_modules/event_projection_router.py webnovel-writer/scripts/data_modules/state_projection_writer.py webnovel-writer/scripts/data_modules/tests/test_event_projection_router.py
git commit -m "feat: add vector route to projection router, handle rejected status"
```

---

## Task 8: 消费端同步

**Files:**
- Modify: `webnovel-writer/agents/context-agent.md`
- Modify: `webnovel-writer/agents/data-agent.md`
- Modify: `webnovel-writer/skills/webnovel-write/SKILL.md`
- Modify: `webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py`

- [ ] **Step 1: 更新 `context-agent.md` 删除旧引用**

1. Section 2 工具段落中，确认 `extract-context` 命令标注为"备选"（已是，不动）
2. 删除对 snapshot 的引用（grep 确认是否有）
3. 确认 Section 8 的输出格式中有写作任务书示例（已在上一次改造中完成）

- [ ] **Step 2: 确认 `data-agent.md` 不直写**

当前 `data-agent.md` 已明确标注：
- "你不直接写入这些文件" （第 111 行）
- "不直接写入 `index.db` 和 `state.json`" （第 146 行）

确认不需要改动。

- [ ] **Step 3: 更新 `SKILL.md` 中 Step 5 简化描述**

把 Step 5.4 的失败隔离表格中增加 vector 相关条目（如果还没有的话）。

确认 Step 1 的写作任务书流程描述和当前代码对齐（已在上一次改造中完成）。

- [ ] **Step 4: 在 `test_prompt_integrity.py` 中更新 `KNOWN_DELETED_FILES`**

新增 `snapshot_manager.py` 到已删文件列表：

```python
KNOWN_DELETED_FILES = [
    "step-1.5-contract.md",
    "step-3-review-gate.md",
    "step-5-debt-switch.md",
    "workflow-details.md",
    "checker-output-schema.md",
    "workflow_manager.py",
    "webnovel-resume",
    "golden_three_checker.py",
    "snapshot_manager.py",
]
```

- [ ] **Step 5: 运行全量 prompt integrity 测试**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_prompt_integrity.py -v`

预期：全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add webnovel-writer/agents/context-agent.md webnovel-writer/agents/data-agent.md webnovel-writer/skills/webnovel-write/SKILL.md webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py
git commit -m "refactor: sync consumer prompts with new mainline"
```

---

## Task 9: 向量投影 Writer

**Files:**
- Create: `webnovel-writer/scripts/data_modules/vector_projection_writer.py`
- Modify: `webnovel-writer/scripts/data_modules/chapter_commit_service.py`
- Create: `webnovel-writer/scripts/data_modules/tests/test_vector_projection_writer.py`

- [ ] **Step 1: 写测试**

```python
# webnovel-writer/scripts/data_modules/tests/test_vector_projection_writer.py
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""VectorProjectionWriter 单元测试。"""
from data_modules.vector_projection_writer import VectorProjectionWriter


def test_event_to_text_formats_power_breakthrough():
    writer = VectorProjectionWriter.__new__(VectorProjectionWriter)
    event = {
        "event_type": "power_breakthrough",
        "chapter": 47,
        "subject": "韩立",
        "payload": {"field": "realm", "new": "筑基初期"},
    }
    text = writer._event_to_text(event)
    assert "第47章" in text
    assert "韩立" in text
    assert "筑基初期" in text


def test_delta_to_text_formats_relationship():
    writer = VectorProjectionWriter.__new__(VectorProjectionWriter)
    delta = {
        "from_entity": "韩立",
        "to_entity": "陈巧倩",
        "relationship_type": "合作",
        "chapter": 47,
    }
    text = writer._delta_to_text(delta)
    assert "第47章" in text
    assert "韩立" in text
    assert "陈巧倩" in text
    assert "合作" in text


def test_collect_chunks_from_commit():
    writer = VectorProjectionWriter.__new__(VectorProjectionWriter)
    payload = {
        "meta": {"chapter": 47, "status": "accepted"},
        "accepted_events": [
            {
                "event_type": "power_breakthrough",
                "chapter": 47,
                "subject": "韩立",
                "payload": {"field": "realm", "new": "筑基初期"},
            },
        ],
        "entity_deltas": [
            {
                "from_entity": "韩立",
                "to_entity": "陈巧倩",
                "relationship_type": "合作",
                "chapter": 47,
            },
        ],
    }
    chunks = writer._collect_chunks(payload)
    assert len(chunks) == 2
    assert chunks[0]["chunk_type"] == "event"
    assert chunks[1]["chunk_type"] == "entity_delta"


def test_rejected_commit_returns_not_applied():
    writer = VectorProjectionWriter.__new__(VectorProjectionWriter)
    writer.project_root = None  # won't be used
    result = writer.apply({"meta": {"status": "rejected", "chapter": 1}})
    assert result["applied"] is False
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_vector_projection_writer.py -v`

预期：FAIL（模块不存在）。

- [ ] **Step 3: 实现 `vector_projection_writer.py`**

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


class VectorProjectionWriter:
    def __init__(self, project_root: Path):
        self.project_root = Path(project_root)

    def apply(self, commit_payload: dict) -> dict:
        if commit_payload["meta"]["status"] != "accepted":
            return {"applied": False, "writer": "vector", "reason": "commit_rejected"}

        chunks = self._collect_chunks(commit_payload)
        if not chunks:
            return {"applied": False, "writer": "vector", "reason": "no_chunks"}

        try:
            stored = self._store_chunks(chunks)
            return {"applied": stored > 0, "writer": "vector", "stored": stored}
        except Exception as exc:
            logger.warning("vector_projection_failed: %s", exc)
            return {"applied": False, "writer": "vector", "reason": f"error:{exc}"}

    def _collect_chunks(self, commit_payload: dict) -> List[Dict[str, Any]]:
        chunks: List[Dict[str, Any]] = []
        chapter = int(commit_payload.get("meta", {}).get("chapter") or 0)

        for event in commit_payload.get("accepted_events") or []:
            if not isinstance(event, dict):
                continue
            text = self._event_to_text(event)
            if text:
                evt_chapter = int(event.get("chapter") or chapter)
                chunks.append({
                    "chapter": evt_chapter,
                    "scene_index": 0,
                    "content": text,
                    "chunk_type": "event",
                    "parent_chunk_id": f"ch{evt_chapter:04d}_summary",
                    "source_file": f"commit:chapter_{evt_chapter:03d}",
                })

        for delta in commit_payload.get("entity_deltas") or []:
            if not isinstance(delta, dict):
                continue
            text = self._delta_to_text(delta)
            if text:
                d_chapter = int(delta.get("chapter") or chapter)
                chunks.append({
                    "chapter": d_chapter,
                    "scene_index": 0,
                    "content": text,
                    "chunk_type": "entity_delta",
                    "parent_chunk_id": f"ch{d_chapter:04d}_summary",
                    "source_file": f"commit:chapter_{d_chapter:03d}",
                })

        return chunks

    def _event_to_text(self, event: dict) -> str:
        chapter = int(event.get("chapter") or 0)
        subject = str(event.get("subject") or "").strip()
        event_type = str(event.get("event_type") or "").strip()
        payload = event.get("payload") or {}

        if event_type == "power_breakthrough":
            new_val = str(payload.get("new") or payload.get("to") or "").strip()
            return f"第{chapter}章：{subject}突破至{new_val}" if new_val else ""
        elif event_type == "character_state_changed":
            field = str(payload.get("field") or "").strip()
            new_val = str(payload.get("new") or payload.get("to") or "").strip()
            return f"第{chapter}章：{subject}的{field}变为{new_val}" if field and new_val else ""
        elif event_type == "relationship_changed":
            to_entity = str(payload.get("to_entity") or payload.get("to") or "").strip()
            rel_type = str(
                payload.get("relationship_type") or payload.get("type") or ""
            ).strip()
            return f"第{chapter}章：{subject}与{to_entity}关系变为{rel_type}" if to_entity else ""
        elif event_type in ("world_rule_revealed", "world_rule_broken"):
            desc = str(payload.get("description") or payload.get("rule") or "").strip()
            action = "揭示" if "revealed" in event_type else "打破"
            return f"第{chapter}章：{action}世界规则——{desc}" if desc else ""
        elif event_type == "artifact_obtained":
            name = str(payload.get("name") or subject or "").strip()
            owner = str(payload.get("owner") or payload.get("holder") or "").strip()
            return f"第{chapter}章：{owner}获得{name}" if owner else f"第{chapter}章：获得{name}"
        return ""

    def _delta_to_text(self, delta: dict) -> str:
        chapter = int(delta.get("chapter") or 0)
        from_e = str(delta.get("from_entity") or "").strip()
        to_e = str(delta.get("to_entity") or "").strip()
        rel = str(delta.get("relationship_type") or "").strip()

        if from_e and to_e and rel:
            return f"第{chapter}章：{from_e}与{to_e}关系变为{rel}"

        entity_id = str(delta.get("entity_id") or "").strip()
        canonical = str(delta.get("canonical_name") or entity_id).strip()
        if entity_id:
            return f"第{chapter}章：实体变更——{canonical}"
        return ""

    def _store_chunks(self, chunks: List[Dict[str, Any]]) -> int:
        from .config import DataModulesConfig
        from .rag_adapter import RAGAdapter

        config = DataModulesConfig.from_project_root(self.project_root)
        adapter = RAGAdapter(config)
        try:
            stored = asyncio.run(adapter.store_chunks(chunks))
            return stored
        except Exception as exc:
            logger.warning("vector_store_failed: %s", exc)
            return 0
```

- [ ] **Step 4: 在 `chapter_commit_service.py` 注册 vector writer**

在 `apply_projections` 方法中（第 104-109 行），加入 vector writer：

```python
from .vector_projection_writer import VectorProjectionWriter

writers = {
    "state": StateProjectionWriter(self.project_root),
    "index": IndexProjectionWriter(self.project_root),
    "summary": SummaryProjectionWriter(self.project_root),
    "memory": MemoryProjectionWriter(self.project_root),
    "vector": VectorProjectionWriter(self.project_root),
}
```

同时在 `build_commit` 的 `projection_status` 中加 `"vector": "pending"`：

```python
"projection_status": {
    "state": "pending",
    "index": "pending",
    "summary": "pending",
    "memory": "pending",
    "vector": "pending",
},
```

- [ ] **Step 5: 运行测试**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_vector_projection_writer.py -v`

预期：全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add webnovel-writer/scripts/data_modules/vector_projection_writer.py webnovel-writer/scripts/data_modules/chapter_commit_service.py webnovel-writer/scripts/data_modules/tests/test_vector_projection_writer.py
git commit -m "feat: add vector_projection_writer for event/entity embedding"
```

---

## Task 10: 时序查询接口

**Files:**
- Create: `webnovel-writer/scripts/data_modules/knowledge_query.py`
- Create: `webnovel-writer/scripts/data_modules/tests/test_knowledge_query.py`
- Modify: `webnovel-writer/scripts/data_modules/webnovel.py` (register CLI subcommand)

- [ ] **Step 1: 写测试**

```python
# webnovel-writer/scripts/data_modules/tests/test_knowledge_query.py
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""KnowledgeQuery 时序查询测试。"""
import json
import sqlite3
from pathlib import Path

import pytest

from data_modules.knowledge_query import KnowledgeQuery


@pytest.fixture
def setup_db(tmp_path):
    """创建带 state_changes 和 relationship_events 表的测试 DB。"""
    db_path = tmp_path / ".webnovel" / "index.db"
    db_path.parent.mkdir(parents=True)

    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS entities (
            id TEXT PRIMARY KEY,
            canonical_name TEXT,
            type TEXT DEFAULT '角色',
            current_json TEXT DEFAULT '{}',
            created_at TEXT,
            updated_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS state_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id TEXT,
            field TEXT,
            old_value TEXT,
            new_value TEXT,
            chapter INTEGER,
            created_at TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS relationship_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_entity TEXT,
            to_entity TEXT,
            relationship_type TEXT,
            description TEXT,
            chapter INTEGER,
            created_at TEXT
        )
    """)

    # 插入测试数据
    conn.execute(
        "INSERT INTO entities (id, canonical_name, current_json) VALUES (?, ?, ?)",
        ("hanli", "韩立", json.dumps({"realm": "筑基中期", "location": "乱星海"})),
    )
    conn.execute(
        "INSERT INTO state_changes (entity_id, field, old_value, new_value, chapter) VALUES (?, ?, ?, ?, ?)",
        ("hanli", "realm", "练气圆满", "筑基初期", 30),
    )
    conn.execute(
        "INSERT INTO state_changes (entity_id, field, old_value, new_value, chapter) VALUES (?, ?, ?, ?, ?)",
        ("hanli", "realm", "筑基初期", "筑基中期", 50),
    )
    conn.execute(
        "INSERT INTO relationship_events (from_entity, to_entity, relationship_type, chapter) VALUES (?, ?, ?, ?)",
        ("hanli", "陈巧倩", "同门", 20),
    )
    conn.execute(
        "INSERT INTO relationship_events (from_entity, to_entity, relationship_type, chapter) VALUES (?, ?, ?, ?)",
        ("hanli", "陈巧倩", "合作", 45),
    )
    conn.commit()
    conn.close()

    return tmp_path


def test_entity_state_at_chapter_before_first_change(setup_db):
    kq = KnowledgeQuery(setup_db)
    result = kq.entity_state_at_chapter("hanli", 10)
    # 第10章在第一次 state_change 之前，应返回空变更
    assert result["entity_id"] == "hanli"
    assert result["state_at_chapter"] == {}


def test_entity_state_at_chapter_after_first_breakthrough(setup_db):
    kq = KnowledgeQuery(setup_db)
    result = kq.entity_state_at_chapter("hanli", 35)
    assert result["state_at_chapter"]["realm"] == "筑基初期"


def test_entity_state_at_chapter_after_second_breakthrough(setup_db):
    kq = KnowledgeQuery(setup_db)
    result = kq.entity_state_at_chapter("hanli", 60)
    assert result["state_at_chapter"]["realm"] == "筑基中期"


def test_relationships_at_chapter_before_any(setup_db):
    kq = KnowledgeQuery(setup_db)
    result = kq.entity_relationships_at_chapter("hanli", 10)
    assert result["relationships"] == []


def test_relationships_at_chapter_after_first(setup_db):
    kq = KnowledgeQuery(setup_db)
    result = kq.entity_relationships_at_chapter("hanli", 25)
    assert len(result["relationships"]) == 1
    assert result["relationships"][0]["to_entity"] == "陈巧倩"
    assert result["relationships"][0]["relationship_type"] == "同门"


def test_relationships_at_chapter_after_update(setup_db):
    kq = KnowledgeQuery(setup_db)
    result = kq.entity_relationships_at_chapter("hanli", 50)
    rels = result["relationships"]
    assert len(rels) == 1
    assert rels[0]["relationship_type"] == "合作"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_knowledge_query.py -v`

预期：FAIL。

- [ ] **Step 3: 实现 `knowledge_query.py`**

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Dict, List


class KnowledgeQuery:
    def __init__(self, project_root: Path):
        self.project_root = Path(project_root)
        self._db_path = self.project_root / ".webnovel" / "index.db"

    def entity_state_at_chapter(self, entity_id: str, chapter: int) -> Dict[str, Any]:
        """查询实体在指定章节时的状态（从 state_changes 反推）。"""
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                """
                SELECT field, new_value
                FROM state_changes
                WHERE entity_id = ? AND chapter <= ?
                ORDER BY chapter ASC, id ASC
                """,
                (entity_id, chapter),
            ).fetchall()

            state: Dict[str, str] = {}
            for row in rows:
                field = str(row["field"] or "").strip()
                if field:
                    state[field] = str(row["new_value"] or "").strip()

            return {
                "entity_id": entity_id,
                "at_chapter": chapter,
                "state_at_chapter": state,
            }
        finally:
            conn.close()

    def entity_relationships_at_chapter(self, entity_id: str, chapter: int) -> Dict[str, Any]:
        """查询实体在指定章节时的所有关系（从 relationship_events 计算快照）。"""
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                """
                SELECT from_entity, to_entity, relationship_type, description, chapter
                FROM relationship_events
                WHERE (from_entity = ? OR to_entity = ?) AND chapter <= ?
                ORDER BY chapter ASC, id ASC
                """,
                (entity_id, entity_id, chapter),
            ).fetchall()

            # 用最新的关系覆盖旧关系（按 pair 去重，保留最新）
            latest: Dict[str, Dict[str, Any]] = {}
            for row in rows:
                from_e = str(row["from_entity"] or "").strip()
                to_e = str(row["to_entity"] or "").strip()
                pair_key = tuple(sorted([from_e, to_e]))
                latest[str(pair_key)] = {
                    "from_entity": from_e,
                    "to_entity": to_e,
                    "relationship_type": str(row["relationship_type"] or "").strip(),
                    "description": str(row["description"] or "").strip(),
                    "since_chapter": int(row["chapter"] or 0),
                }

            return {
                "entity_id": entity_id,
                "at_chapter": chapter,
                "relationships": list(latest.values()),
            }
        finally:
            conn.close()
```

- [ ] **Step 4: 运行测试**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_knowledge_query.py -v`

预期：全部 PASS。

- [ ] **Step 5: 注册 `knowledge` CLI 子命令**

在 `webnovel-writer/scripts/data_modules/webnovel.py` 中注册 `knowledge` 子命令。找到 subparser 注册区域（grep `add_parser`），新增：

```python
# knowledge 子命令
knowledge_parser = subparsers.add_parser("knowledge", help="时序知识查询")
knowledge_sub = knowledge_parser.add_subparsers(dest="knowledge_action")

qs_parser = knowledge_sub.add_parser("query-entity-state", help="查询实体在指定章节的状态")
qs_parser.add_argument("--entity", required=True, help="实体 ID")
qs_parser.add_argument("--at-chapter", type=int, required=True, help="目标章节号")

qr_parser = knowledge_sub.add_parser("query-relationships", help="查询实体在指定章节的关系")
qr_parser.add_argument("--entity", required=True, help="实体 ID")
qr_parser.add_argument("--at-chapter", type=int, required=True, help="目标章节号")
```

在命令分发区域新增 handler：

```python
if args.command == "knowledge":
    from .knowledge_query import KnowledgeQuery
    kq = KnowledgeQuery(project_root)
    if args.knowledge_action == "query-entity-state":
        result = kq.entity_state_at_chapter(args.entity, args.at_chapter)
        print_success(result, message="entity_state_at_chapter")
    elif args.knowledge_action == "query-relationships":
        result = kq.entity_relationships_at_chapter(args.entity, args.at_chapter)
        print_success(result, message="entity_relationships_at_chapter")
```

- [ ] **Step 6: 同步 `REGISTERED_CLI_SUBCOMMANDS` 和 `context-agent.md`**

在 `test_prompt_integrity.py` 的 `REGISTERED_CLI_SUBCOMMANDS`（第 32-38 行）中新增 `"knowledge"`：

```python
REGISTERED_CLI_SUBCOMMANDS = {
    "where", "preflight", "use",
    "index", "state", "rag", "style", "entity", "context", "memory",
    "migrate", "status", "update-state", "backup", "archive",
    "init", "extract-context", "memory-contract", "review-pipeline",
    "story-system", "chapter-commit", "story-events",
    "knowledge",
}
```

在 `context-agent.md` Section 2 的"补充命令"段落中新增：

```bash
# 时序知识查询（查询某实体在指定章节时的状态和关系）
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "{project_root}" knowledge query-entity-state --entity "{entity_id}" --at-chapter {N}
python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "{project_root}" knowledge query-relationships --entity "{entity_id}" --at-chapter {N}
```

- [ ] **Step 7: 运行全量测试**

Run: `cd webnovel-writer && python -m pytest scripts/data_modules/tests/ scripts/tests/ -v --timeout=60`

预期：全部 PASS。

- [ ] **Step 8: Commit**

```bash
git add webnovel-writer/scripts/data_modules/knowledge_query.py webnovel-writer/scripts/data_modules/tests/test_knowledge_query.py webnovel-writer/scripts/data_modules/webnovel.py webnovel-writer/agents/context-agent.md webnovel-writer/scripts/data_modules/tests/test_prompt_integrity.py
git commit -m "feat: add knowledge_query temporal API with CLI and prompt sync"
```

---

## Task 11: 最终集成验证

**Files:** (read-only verification)

- [ ] **Step 1: 运行全量测试套件**

```bash
cd webnovel-writer && python -m pytest scripts/data_modules/tests/ scripts/tests/ -v --timeout=120
```

预期：全部 PASS，0 FAIL。

- [ ] **Step 2: grep 确认无残留散写**

```bash
grep -rn "state set-chapter-status" webnovel-writer/skills/ webnovel-writer/agents/ || echo "CLEAN"
grep -rn "index process-chapter" webnovel-writer/skills/ webnovel-writer/agents/ || echo "CLEAN"
```

预期：两条都输出 `CLEAN`。

- [ ] **Step 3: 确认 context_manager.py 行数**

```bash
wc -l webnovel-writer/scripts/data_modules/context_manager.py
```

预期：< 400 行。

- [ ] **Step 4: 确认 snapshot_manager.py 已删除**

```bash
test -f webnovel-writer/scripts/data_modules/snapshot_manager.py && echo "STILL EXISTS" || echo "DELETED"
```

预期：`DELETED`。

- [ ] **Step 5: 确认裁决表覆盖 7 个题材**

```bash
python3 -c "
import csv
from pathlib import Path
path = Path('webnovel-writer/references/csv/裁决规则.csv')
with open(path, 'r', encoding='utf-8-sig') as f:
    rows = list(csv.DictReader(f))
genres = [r['题材'] for r in rows]
print(f'题材数: {len(genres)}')
print(f'题材: {genres}')
assert len(genres) == 7
"
```

预期：输出 7 个题材。

- [ ] **Step 6: 确认 CSV_CONFIG 对齐**

```bash
cd webnovel-writer && python -m pytest scripts/data_modules/tests/test_csv_config.py -v
```

预期：全部 PASS。

- [ ] **Step 7: Commit final**

如果有任何 fix，commit：

```bash
git add -A
git commit -m "chore: final integration fixes for story system convergence"
```
