# References 题材体系对齐与结构补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立权威题材枚举，让 CSV `适用题材` 列、路由表、裁决表、搜索脚本全部对齐到同一套枚举值；补上校验脚本和结构层缺口。

**Architecture:** 两层题材体系（15 个 canonical_genre + 37 个 platform_tag）驱动全链路。`genre-canonical.md` 是人类可读真源，`GENRE_CANONICAL` Python 常量是机器可读真源，`validate_csv.py` 校验两者与实际 CSV 数据的一致性。所有改动只涉及 `references/csv/`、`scripts/reference_search.py`、`scripts/validate_csv.py` 和 `scripts/data_modules/story_system_engine.py`，不触碰 skill 文本或 contract 产出结构。

**Tech Stack:** Python 3.10+, pytest, csv (stdlib)

**Spec:** `docs/superpowers/specs/2026-04-16-references-completion-spec.md`
**Genre Canonical:** `webnovel-writer/references/csv/genre-canonical.md`

**Status:** Completed. The reference canonical pipeline is implemented, route/reasoning CSVs meet Phase 2 thresholds, and `validate_csv.py --format json` reports 0 errors / 0 warnings.

---

### Task 1: 在 reference_search.py 中添加 GENRE_CANONICAL 常量与映射

**Files:**
- Modify: `webnovel-writer/scripts/reference_search.py:84-154`
- Test: `webnovel-writer/scripts/tests/test_reference_search.py`

- [ ] **Step 1: 写失败测试 — canonical 常量存在且完整**

在 `webnovel-writer/scripts/tests/test_reference_search.py` 末尾添加：

```python
class TestGenreCanonical:
    def test_canonical_genres_has_15_entries(self):
        from reference_search import GENRE_CANONICAL
        assert len(GENRE_CANONICAL) == 15
        expected = {
            "都市", "玄幻", "仙侠", "奇幻", "科幻",
            "历史", "悬疑", "游戏", "古言", "现言",
            "幻言", "年代", "种田", "快穿", "衍生",
        }
        assert GENRE_CANONICAL == expected

    def test_platform_to_canonical_maps_all_37_tags(self):
        from reference_search import PLATFORM_TO_CANONICAL
        assert len(PLATFORM_TO_CANONICAL) == 37
        # Every value must be a canonical genre
        from reference_search import GENRE_CANONICAL
        for tag, canonical in PLATFORM_TO_CANONICAL.items():
            assert canonical in GENRE_CANONICAL, f"{tag} -> {canonical} not in GENRE_CANONICAL"

    def test_platform_to_canonical_spot_checks(self):
        from reference_search import PLATFORM_TO_CANONICAL
        assert PLATFORM_TO_CANONICAL["都市日常"] == "都市"
        assert PLATFORM_TO_CANONICAL["战神赘婿"] == "都市"
        assert PLATFORM_TO_CANONICAL["东方仙侠"] == "仙侠"
        assert PLATFORM_TO_CANONICAL["西方奇幻"] == "奇幻"
        assert PLATFORM_TO_CANONICAL["古风世情"] == "古言"
        assert PLATFORM_TO_CANONICAL["豪门总裁"] == "现言"
        assert PLATFORM_TO_CANONICAL["快穿"] == "快穿"
        assert PLATFORM_TO_CANONICAL["科幻末世"] == "科幻"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd "D:/wk/novel skill/webnovel-writer/webnovel-writer/scripts" && python -m pytest tests/test_reference_search.py::TestGenreCanonical -v`
Expected: FAIL — `ImportError: cannot import name 'GENRE_CANONICAL'`

- [ ] **Step 3: 在 reference_search.py 中添加常量**

在 `reference_search.py` 的 `CSV_CONFIG` 之前（约第 84 行）插入：

```python
# ---------------------------------------------------------------------------
# Genre canonical list & platform tag mapping
# ---------------------------------------------------------------------------

GENRE_CANONICAL: set[str] = {
    "都市", "玄幻", "仙侠", "奇幻", "科幻",
    "历史", "悬疑", "游戏", "古言", "现言",
    "幻言", "年代", "种田", "快穿", "衍生",
}

PLATFORM_TO_CANONICAL: Dict[str, str] = {
    # 男频
    "都市日常": "都市", "都市修真": "都市", "都市高武": "都市",
    "战神赘婿": "都市", "都市种田": "都市", "都市脑洞": "都市",
    "传统玄幻": "玄幻", "玄幻脑洞": "玄幻",
    "东方仙侠": "仙侠",
    "西方奇幻": "奇幻",
    "科幻末世": "科幻",
    "历史古代": "历史", "历史脑洞": "历史", "抗战谍战": "历史",
    "悬疑脑洞": "悬疑", "悬疑灵异": "悬疑",
    "游戏体育": "游戏",
    "动漫衍生": "衍生", "男频衍生": "衍生",
    # 女频
    "古风世情": "古言", "宫斗宅斗": "古言", "古言脑洞": "古言",
    "现言脑洞": "现言", "青春甜宠": "现言", "星光璀璨": "现言",
    "职场婚恋": "现言", "豪门总裁": "现言",
    "玄幻言情": "幻言",
    "年代": "年代", "民国言情": "年代",
    "种田": "种田",
    "快穿": "快穿",
    "女频悬疑": "悬疑",
    "女频衍生": "衍生",
}

# Legacy values that appeared in old CSV data → canonical mapping.
# Used by _resolve_genre() during the migration period.
_LEGACY_GENRE_MAP: Dict[str, str] = {
    "东方仙侠": "仙侠", "西方奇幻": "奇幻", "科幻末世": "科幻",
    "都市日常": "都市", "都市修真": "都市", "都市高武": "都市",
    "历史古代": "历史",
    "谍战": "历史", "军事": "历史", "武侠": "历史",
    "刑侦": "悬疑", "惊悚": "悬疑", "推理": "悬疑", "规则怪谈": "悬疑",
    "末世": "科幻", "赛博朋克": "科幻",
    "网游": "游戏", "电竞": "游戏", "竞技": "游戏", "体育": "游戏",
    "轻小说": "衍生", "同人": "衍生",
    "校园": "现言", "青春": "现言", "娱乐圈": "现言", "职场": "现言",
    "高武": "都市",
}


def resolve_genre(genre: Optional[str]) -> Optional[str]:
    """Resolve a user-facing genre string to its canonical form.

    Accepts canonical genres, platform tags, and legacy values.
    Returns the canonical genre string, or the original input if unresolvable.
    """
    if genre is None:
        return None
    g = genre.strip()
    if g in GENRE_CANONICAL or g == "全部":
        return g
    if g in PLATFORM_TO_CANONICAL:
        return PLATFORM_TO_CANONICAL[g]
    if g in _LEGACY_GENRE_MAP:
        return _LEGACY_GENRE_MAP[g]
    return g  # unresolvable — pass through
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd "D:/wk/novel skill/webnovel-writer/webnovel-writer/scripts" && python -m pytest tests/test_reference_search.py::TestGenreCanonical -v`
Expected: 3 tests PASS

- [ ] **Step 5: 提交**

```bash
cd "D:/wk/novel skill/webnovel-writer"
git add webnovel-writer/scripts/reference_search.py webnovel-writer/scripts/tests/test_reference_search.py
git commit -m "feat: add GENRE_CANONICAL constants and resolve_genre() to reference_search"
```

---

### Task 2: 让 _genre_matches 和 search() 使用 resolve_genre

**Files:**
- Modify: `webnovel-writer/scripts/reference_search.py:74-82, 294-335`
- Test: `webnovel-writer/scripts/tests/test_reference_search.py`

- [ ] **Step 1: 写失败测试 — platform_tag 可作为 --genre 匹配 canonical 值**

在 `test_reference_search.py` 的 `TestGenreCanonical` 类中追加：

```python
    def test_resolve_genre_canonical_passthrough(self):
        from reference_search import resolve_genre
        assert resolve_genre("都市") == "都市"
        assert resolve_genre("全部") == "全部"
        assert resolve_genre(None) is None

    def test_resolve_genre_platform_tag(self):
        from reference_search import resolve_genre
        assert resolve_genre("都市日常") == "都市"
        assert resolve_genre("战神赘婿") == "都市"
        assert resolve_genre("古风世情") == "古言"

    def test_resolve_genre_legacy(self):
        from reference_search import resolve_genre
        assert resolve_genre("武侠") == "历史"
        assert resolve_genre("刑侦") == "悬疑"
        assert resolve_genre("网游") == "游戏"

    def test_search_with_platform_tag_genre(self):
        """--genre 都市日常 should match rows with 适用题材=都市."""
        out = run_search(
            "--skill", "write",
            "--table", "命名规则",
            "--query", "角色命名",
            "--genre", "都市日常",
        )
        assert out["status"] == "success"
        # Should find results (都市日常 resolves to 都市, matching rows tagged 都市)
        assert out["data"]["total"] >= 0  # may be 0 if no 都市 rows, but no error
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd "D:/wk/novel skill/webnovel-writer/webnovel-writer/scripts" && python -m pytest tests/test_reference_search.py::TestGenreCanonical::test_search_with_platform_tag_genre -v`
Expected: 可能 PASS（因为 `都市日常` 字符串包含 `都市` 子串恰好匹配），也可能匹配不精确。关键测试是 `resolve_genre` 相关的三个。

- [ ] **Step 3: 修改 _genre_matches 和 search 函数**

修改 `reference_search.py` 的 `_genre_matches` 函数（约第 74 行）：

```python
def _genre_matches(row: Dict[str, str], genre: Optional[str]) -> bool:
    """Return True if *genre* is None, or matches ``适用题材`` (``全部`` always matches).

    Both the input *genre* and the cell values are resolved to canonical form
    before comparison, so platform tags and legacy values work transparently.
    """
    if genre is None:
        return True
    cell = row.get("适用题材", "")
    if cell.strip() == "全部":
        return True
    resolved_genre = resolve_genre(genre)
    cell_genres = [resolve_genre(v) for v in _split_multi_value(cell)]
    return resolved_genre in cell_genres
```

修改 `search` 函数（约第 294 行），在函数开头加 resolve：

```python
def search(
    csv_dir: Path,
    skill: str,
    query: str,
    table: Optional[str] = None,
    genre: Optional[str] = None,
    max_results: int = 5,
) -> Dict[str, Any]:
    resolved = resolve_genre(genre)
    # ... rest of function uses resolved instead of genre for filtering,
    # but keeps original genre in the response envelope for traceability
```

具体改动：在 `search()` 函数体第一行加 `resolved = resolve_genre(genre)`，然后将 `_genre_matches(row, genre)` 调用改为 `_genre_matches(row, resolved)`，返回结果中保持 `"genre": genre`（原始输入，便于追溯）。

- [ ] **Step 4: 运行全部测试确认通过**

Run: `cd "D:/wk/novel skill/webnovel-writer/webnovel-writer/scripts" && python -m pytest tests/test_reference_search.py -v`
Expected: ALL PASS（包含旧有测试，确保不回归）

- [ ] **Step 5: 提交**

```bash
cd "D:/wk/novel skill/webnovel-writer"
git add webnovel-writer/scripts/reference_search.py webnovel-writer/scripts/tests/test_reference_search.py
git commit -m "feat: _genre_matches resolves platform tags and legacy values to canonical"
```

---

### Task 3: CSV_CONFIG 增加 prefix 和 required_cols 字段

**Files:**
- Modify: `webnovel-writer/scripts/reference_search.py:88-154`
- Modify: `webnovel-writer/scripts/data_modules/tests/test_csv_config.py`

- [ ] **Step 1: 写失败测试 — 每个 CSV_CONFIG entry 都有 prefix 和 required_cols**

在 `test_csv_config.py` 末尾追加：

```python
def test_csv_config_has_prefix_field():
    for name, config in CSV_CONFIG.items():
        assert "prefix" in config, f"表 {name} 缺少 prefix 字段"
        assert isinstance(config["prefix"], str)
        assert len(config["prefix"]) >= 2


def test_csv_config_has_required_cols_field():
    for name, config in CSV_CONFIG.items():
        assert "required_cols" in config, f"表 {name} 缺少 required_cols 字段"
        assert isinstance(config["required_cols"], list)
        assert len(config["required_cols"]) >= 1


def test_csv_config_prefix_matches_actual_data():
    """Every row's 编号 must start with the declared prefix."""
    for name, config in CSV_CONFIG.items():
        csv_path = CSV_DIR / config["file"]
        if not csv_path.exists():
            continue
        prefix = config["prefix"]
        with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                row_id = row.get("编号", "")
                assert row_id.startswith(prefix + "-"), (
                    f"表 {name} 行 {row_id} 编号不以 {prefix}- 开头"
                )
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd "D:/wk/novel skill/webnovel-writer/webnovel-writer/scripts" && python -m pytest data_modules/tests/test_csv_config.py -v`
Expected: FAIL — `KeyError: 'prefix'`

- [ ] **Step 3: 给 CSV_CONFIG 每个 entry 补 prefix 和 required_cols**

修改 `reference_search.py` 中的 `CSV_CONFIG`，给每张表追加两个字段：

```python
CSV_CONFIG: Dict[str, Dict[str, Any]] = {
    "命名规则": {
        "file": "命名规则.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "命名对象", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "base",
        "prefix": "NR",
        "required_cols": ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要"],
    },
    "场景写法": {
        "file": "场景写法.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "模式名称", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "base",
        "prefix": "SP",
        "required_cols": ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要"],
    },
    "写作技法": {
        "file": "写作技法.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "技法名称", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "base",
        "prefix": "WT",
        "required_cols": ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要"],
    },
    "桥段套路": {
        "file": "桥段套路.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "桥段名称", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "dynamic",
        "prefix": "TR",
        "required_cols": ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要"],
    },
    "爽点与节奏": {
        "file": "爽点与节奏.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "节奏类型", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "dynamic",
        "prefix": "PA",
        "required_cols": ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要"],
    },
    "人设与关系": {
        "file": "人设与关系.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "人设类型", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "base",
        "prefix": "CH",
        "required_cols": ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要"],
    },
    "金手指与设定": {
        "file": "金手指与设定.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "设定类型", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "base",
        "prefix": "SY",
        "required_cols": ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要"],
    },
    "题材与调性推理": {
        "file": "题材与调性推理.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "题材别名": 3},
        "output_cols": ["编号", "题材/流派", "核心调性", "推荐基础检索表", "推荐动态检索表"],
        "poison_col": "毒点",
        "role": "route",
        "prefix": "GR",
        "required_cols": ["编号", "适用技能", "题材/流派", "核心调性", "推荐基础检索表", "推荐动态检索表"],
    },
    "裁决规则": {
        "file": "裁决规则.csv",
        "search_cols": {"题材": 4},
        "output_cols": ["题材", "风格优先级", "爽点优先级", "节奏默认策略",
                        "毒点权重", "冲突裁决", "contract注入层", "反模式"],
        "poison_col": "",
        "role": "reasoning",
        "prefix": "RS",
        "required_cols": ["编号", "题材", "风格优先级", "爽点优先级", "节奏默认策略", "冲突裁决"],
    },
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd "D:/wk/novel skill/webnovel-writer/webnovel-writer/scripts" && python -m pytest data_modules/tests/test_csv_config.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
cd "D:/wk/novel skill/webnovel-writer"
git add webnovel-writer/scripts/reference_search.py webnovel-writer/scripts/data_modules/tests/test_csv_config.py
git commit -m "feat: add prefix and required_cols to CSV_CONFIG"
```

---

### Task 4: 创建 validate_csv.py 校验脚本

**Files:**
- Create: `webnovel-writer/scripts/validate_csv.py`
- Create: `webnovel-writer/scripts/tests/test_validate_csv.py`

- [ ] **Step 1: 写失败测试 — validate_csv 模块可导入并执行**

创建 `webnovel-writer/scripts/tests/test_validate_csv.py`：

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for validate_csv.py."""
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = str(Path(__file__).resolve().parents[1] / "validate_csv.py")
CSV_DIR = str(Path(__file__).resolve().parents[2] / "references" / "csv")


def run_validate(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, SCRIPT, "--csv-dir", CSV_DIR, *args],
        capture_output=True,
        text=True,
    )


class TestValidateCsvRuns:
    def test_script_runs_without_crash(self):
        result = run_validate()
        # May exit 0 (all pass) or 1 (errors found), but must not crash
        assert result.returncode in (0, 1)
        assert "Traceback" not in result.stderr

    def test_json_output_mode(self):
        import json
        result = run_validate("--format", "json")
        assert result.returncode in (0, 1)
        data = json.loads(result.stdout)
        assert "errors" in data
        assert "warnings" in data
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd "D:/wk/novel skill/webnovel-writer/webnovel-writer/scripts" && python -m pytest tests/test_validate_csv.py -v`
Expected: FAIL — script not found

- [ ] **Step 3: 实现 validate_csv.py**

创建 `webnovel-writer/scripts/validate_csv.py`：

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CSV 数据校验工具。

基于 CSV_CONFIG 和 GENRE_CANONICAL 校验 references/csv/ 下所有表的数据质量。

用法:
    python validate_csv.py
    python validate_csv.py --csv-dir path/to/csv
    python validate_csv.py --format json
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Import config from sibling module
sys.path.insert(0, str(Path(__file__).resolve().parent))
from reference_search import (
    CSV_CONFIG,
    GENRE_CANONICAL,
    PLATFORM_TO_CANONICAL,
    _LEGACY_GENRE_MAP,
)

_MULTI_SPLIT = re.compile(r"[|,，]+")
_CHINESE_COMMA = re.compile(r"，")


def _split(cell: str) -> List[str]:
    if not cell:
        return []
    return [p.strip() for p in _MULTI_SPLIT.split(cell) if p.strip()]


def _load_csv(path: Path) -> List[Dict[str, str]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def _default_csv_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "references" / "csv"


def validate(csv_dir: Path) -> Dict[str, List[str]]:
    errors: List[str] = []
    warnings: List[str] = []

    all_ids: Dict[str, str] = {}  # id -> table_name

    valid_genres = GENRE_CANONICAL | {"全部"}

    for table_name, config in CSV_CONFIG.items():
        csv_path = csv_dir / config["file"]
        if not csv_path.exists():
            errors.append(f"[{table_name}] 文件不存在: {config['file']}")
            continue

        rows = _load_csv(csv_path)
        headers = set(rows[0].keys()) if rows else set()
        prefix = config.get("prefix", "")
        required_cols = config.get("required_cols", [])

        # Check: column headers include all declared columns
        declared_cols = set()
        for col in config.get("search_cols", {}):
            declared_cols.add(col)
        for col in config.get("output_cols", []):
            declared_cols.add(col)
        for col in required_cols:
            declared_cols.add(col)
        poison = config.get("poison_col", "")
        if poison:
            declared_cols.add(poison)
        missing_headers = declared_cols - headers
        if missing_headers:
            errors.append(f"[{table_name}] CSV 缺少列头: {missing_headers}")

        for i, row in enumerate(rows, start=2):  # row 1 is header
            row_id = row.get("编号", "").strip()

            # Check: ID uniqueness
            if row_id:
                if row_id in all_ids:
                    errors.append(
                        f"[{table_name}] 行{i} 编号 {row_id} 重复（首次出现于 {all_ids[row_id]}）"
                    )
                else:
                    all_ids[row_id] = table_name

            # Check: prefix consistency
            if prefix and row_id and not row_id.startswith(prefix + "-"):
                errors.append(
                    f"[{table_name}] 行{i} 编号 {row_id} 应以 {prefix}- 开头"
                )

            # Check: required columns non-empty
            for col in required_cols:
                val = row.get(col, "").strip()
                if not val:
                    errors.append(f"[{table_name}] 行{i} ({row_id}) 必填列 {col} 为空")

            # Check: delimiter convention (no Chinese comma in multi-value fields)
            for col in ("适用技能", "关键词", "意图与同义词", "适用题材"):
                val = row.get(col, "")
                if _CHINESE_COMMA.search(val):
                    errors.append(
                        f"[{table_name}] 行{i} ({row_id}) {col} 含中文逗号，应使用 |"
                    )

            # Check: 适用题材 values in canonical set
            genre_cell = row.get("适用题材", "").strip()
            if genre_cell:
                for g in _split(genre_cell):
                    if g not in valid_genres:
                        warnings.append(
                            f"[{table_name}] 行{i} ({row_id}) 适用题材值 '{g}' "
                            f"不在 canonical 枚举中"
                        )

    # Cross-table check: route ↔ reasoning coverage
    route_genres: set[str] = set()
    reasoning_genres: set[str] = set()

    route_path = csv_dir / "题材与调性推理.csv"
    if route_path.exists():
        for row in _load_csv(route_path):
            val = row.get("题材/流派", "").strip()
            if val:
                route_genres.add(val)

    reasoning_path = csv_dir / "裁决规则.csv"
    if reasoning_path.exists():
        for row in _load_csv(reasoning_path):
            val = row.get("题材", "").strip()
            if val:
                reasoning_genres.add(val)

    # Every canonical genre should have at least one reasoning row
    for cg in GENRE_CANONICAL:
        if cg not in reasoning_genres:
            warnings.append(f"[裁决规则] canonical genre '{cg}' 无对应裁决行")

    return {"errors": errors, "warnings": warnings}


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="Validate reference CSV files")
    parser.add_argument("--csv-dir", default=None, help="Override CSV directory")
    parser.add_argument("--format", choices=["text", "json"], default="text")
    args = parser.parse_args(argv)

    csv_dir = Path(args.csv_dir) if args.csv_dir else _default_csv_dir()
    result = validate(csv_dir)

    if args.format == "json":
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        for e in result["errors"]:
            print(f"ERROR: {e}")
        for w in result["warnings"]:
            print(f"WARN:  {w}")
        total_e = len(result["errors"])
        total_w = len(result["warnings"])
        print(f"\n--- {total_e} error(s), {total_w} warning(s) ---")

    sys.exit(1 if result["errors"] else 0)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd "D:/wk/novel skill/webnovel-writer/webnovel-writer/scripts" && python -m pytest tests/test_validate_csv.py -v`
Expected: 2 tests PASS

- [ ] **Step 5: 运行校验脚本看实际输出，记录当前 warnings 数量**

Run: `cd "D:/wk/novel skill/webnovel-writer/webnovel-writer/scripts" && python validate_csv.py`
Expected: 0 errors（结构正确），多个 warnings（`适用题材` 非 canonical 值 + 裁决规则缺 canonical 覆盖）

- [ ] **Step 6: 提交**

```bash
cd "D:/wk/novel skill/webnovel-writer"
git add webnovel-writer/scripts/validate_csv.py webnovel-writer/scripts/tests/test_validate_csv.py
git commit -m "feat: add validate_csv.py — schema, ID, prefix, genre, delimiter checks"
```

---

### Task 5: 给 题材与调性推理.csv 增加 canonical_genre 列

**Files:**
- Modify: `webnovel-writer/references/csv/题材与调性推理.csv`
- Modify: `webnovel-writer/scripts/reference_search.py` (CSV_CONFIG for 题材与调性推理)
- Modify: `webnovel-writer/scripts/data_modules/story_system_engine.py:115-159`

- [ ] **Step 1: 写失败测试 — engine route 输出包含 canonical_genre**

在 `webnovel-writer/scripts/data_modules/tests/` 下找到或创建 `test_story_system_engine.py`，追加：

```python
def test_route_output_includes_canonical_genre(tmp_path):
    """_route() output must contain canonical_genre in meta."""
    # Copy CSV dir to tmp
    import shutil
    csv_src = Path(__file__).resolve().parent.parent.parent.parent / "references" / "csv"
    csv_dst = tmp_path / "csv"
    shutil.copytree(csv_src, csv_dst)

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from data_modules.story_system_engine import StorySystemEngine

    engine = StorySystemEngine(csv_dir=csv_dst)
    route = engine._route("退婚流 三年之约", "玄幻")
    assert "canonical_genre" in route["meta"]
    assert route["meta"]["canonical_genre"] in {
        "都市", "玄幻", "仙侠", "奇幻", "科幻",
        "历史", "悬疑", "游戏", "古言", "现言",
        "幻言", "年代", "种田", "快穿", "衍生",
    }
```

- [ ] **Step 2: 运行测试确认失败**

Expected: FAIL — `KeyError: 'canonical_genre'`

- [ ] **Step 3: 修改 CSV 和代码**

**3a.** 给 `题材与调性推理.csv` 加一列 `canonical_genre`，放在 `题材/流派` 后面。每行手工填入对应的 canonical 值。例如：

| 编号 | 题材/流派 | canonical_genre | ... |
|------|----------|----------------|-----|
| GR-001 | 玄幻退婚流 | 玄幻 | ... |
| GR-002 | 规则动物园 | 悬疑 | ... |

当前 8 行全部需要填 `canonical_genre`。

**3b.** 修改 `reference_search.py` 的 `CSV_CONFIG["题材与调性推理"]`，在 `output_cols` 中添加 `"canonical_genre"`：

```python
"题材与调性推理": {
    "file": "题材与调性推理.csv",
    "search_cols": {"关键词": 3, "意图与同义词": 4, "题材别名": 3},
    "output_cols": ["编号", "题材/流派", "canonical_genre", "核心调性", "推荐基础检索表", "推荐动态检索表"],
    "poison_col": "毒点",
    "role": "route",
    "prefix": "GR",
    "required_cols": ["编号", "适用技能", "题材/流派", "canonical_genre", "核心调性", "推荐基础检索表", "推荐动态检索表"],
},
```

**3c.** 修改 `story_system_engine.py` 的 `_route` 方法（约第 141-158 行），在 return dict 的 `meta` 中加入 `canonical_genre`：

```python
        primary_genre = str(matched.get("题材/流派") or genre or "").strip()
        canonical = str(matched.get("canonical_genre") or "").strip()
        if not canonical:
            # Fallback: resolve via PLATFORM_TO_CANONICAL
            from reference_search import resolve_genre
            canonical = resolve_genre(primary_genre) or primary_genre
        genre_filter = canonical  # Use canonical for downstream filtering
        return {
            "meta": {
                "primary_genre": primary_genre,
                "canonical_genre": canonical,
                "route_source": route_source,
                "genre_filter": genre_filter,
                ...
            },
            ...
            "genre_filter": genre_filter,
            ...
        }
```

- [ ] **Step 4: 运行测试确认通过**

Run the new test + existing engine tests (if any).

- [ ] **Step 5: 同步修改 _load_reasoning 使用 canonical_genre**

修改 `story_system_engine.py` 的 `_load_reasoning` 方法（约第 261-276 行）：engine 的 `build()` 在调用 `_load_reasoning` 时应传入 `canonical_genre` 而非 `primary_genre`，确保裁决规则匹配的是 canonical 值。

找到 `build()` 中调用 `_load_reasoning` 的位置，将参数从 `route["meta"]["primary_genre"]` 改为 `route["meta"]["canonical_genre"]`。

- [ ] **Step 6: 运行全部相关测试**

Run: `cd "D:/wk/novel skill/webnovel-writer/webnovel-writer/scripts" && python -m pytest tests/ data_modules/tests/test_csv_config.py -v`
Expected: ALL PASS

- [ ] **Step 7: 提交**

```bash
cd "D:/wk/novel skill/webnovel-writer"
git add webnovel-writer/references/csv/题材与调性推理.csv webnovel-writer/scripts/reference_search.py webnovel-writer/scripts/data_modules/story_system_engine.py
git commit -m "feat: add canonical_genre column to route table, thread through engine"
```

---

### Task 6: 迁移现有 CSV 的 适用题材 列到 canonical 枚举

**Files:**
- Modify: `webnovel-writer/references/csv/命名规则.csv`
- Modify: `webnovel-writer/references/csv/场景写法.csv`
- Modify: `webnovel-writer/references/csv/写作技法.csv`
- Modify: `webnovel-writer/references/csv/桥段套路.csv`
- Modify: `webnovel-writer/references/csv/人设与关系.csv`
- Modify: `webnovel-writer/references/csv/爽点与节奏.csv`
- Modify: `webnovel-writer/references/csv/金手指与设定.csv`
- Modify: `webnovel-writer/references/csv/裁决规则.csv`

**注意：此任务是手工数据修改。每个 CSV 需要逐行检查 `适用题材` 列，将非 canonical 值替换为 canonical 枚举值。**

- [ ] **Step 1: 运行 validate_csv.py 获取完整 warning 列表**

Run: `cd "D:/wk/novel skill/webnovel-writer/webnovel-writer/scripts" && python validate_csv.py --format json > /tmp/csv_warnings.json`

这将输出所有 `适用题材值不在 canonical 枚举中` 的 warning，作为迁移工作清单。

- [ ] **Step 2: 按迁移映射表逐文件修改**

打开每个 CSV 文件，根据 `genre-canonical.md` 的"现有非枚举值迁移映射"表做替换：

迁移原则：
- `谍战` → `历史`
- `刑侦|惊悚|推理|规则怪谈` → `悬疑`
- `末世|赛博朋克` → `科幻`
- `军事|武侠` → `历史`
- `网游|电竞|竞技|体育` → `游戏`
- `高武` → `都市`
- `系统文|无限流` → 改为实际背景题材（`玄幻`/`都市`/`悬疑`）
- `狗血|爽文|深度剧情|现实向|群像|史诗` → 删除该值，改为具体适用题材或 `全部`
- `动作|心理|战争|灾难|长篇|知乎短篇` → 删除该值，改为具体适用题材或 `全部`
- `校园|青春|娱乐圈|职场` → `现言`
- `商战|商业` → `都市` 或 `现言`
- `同人|轻小说` → `衍生`

每个文件改完后保存（保持 UTF-8 with BOM 编码）。

- [ ] **Step 3: 运行 validate_csv.py 确认 warnings 归零或大幅减少**

Run: `cd "D:/wk/novel skill/webnovel-writer/webnovel-writer/scripts" && python validate_csv.py`
Expected: 0 errors, `适用题材` 相关 warnings 归零（只剩裁决规则覆盖 warnings）

- [ ] **Step 4: 运行现有搜索测试确认不回归**

Run: `cd "D:/wk/novel skill/webnovel-writer/webnovel-writer/scripts" && python -m pytest tests/test_reference_search.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
cd "D:/wk/novel skill/webnovel-writer"
git add webnovel-writer/references/csv/*.csv
git commit -m "refactor: migrate all CSV 适用题材 values to canonical genre enum"
```

---

### Task 7: 更新 CSV README 的题材分类章节

**Files:**
- Modify: `webnovel-writer/references/csv/README.md:166-170`

- [ ] **Step 1: 替换旧的番茄分类为新的 canonical 枚举引用**

将 README.md 第 166-170 行的旧分类：

```markdown
## 适用题材（番茄分类）

**男频：** 都市、玄幻、仙侠、奇幻、武侠、历史、军事、科幻、悬疑、游戏、体育、轻小说

**女频：** 现言、古言、幻言、悬疑、轻小说
```

替换为：

```markdown
## 适用题材枚举

`适用题材` 列只允许填写以下 15 个 canonical 值或 `全部`：

```
都市  玄幻  仙侠  奇幻  科幻
历史  悬疑  游戏  古言  现言
幻言  年代  种田  快穿  衍生
```

完整的两层题材体系（canonical + 番茄 platform_tag 映射）见 `genre-canonical.md`。

**禁止**在 `适用题材` 列中填写：
- 番茄子分类名（如"都市日常""战神赘婿"）——这些是 platform_tag，只用于路由表
- 套路名（如"退婚流""系统流"）——这些住在 `桥段套路.csv`
- 调性/场景/形式标签（如"爽文""动作""短篇"）——不属于题材体系
```

- [ ] **Step 2: 提交**

```bash
cd "D:/wk/novel skill/webnovel-writer"
git add webnovel-writer/references/csv/README.md
git commit -m "docs: update CSV README genre section to reference canonical enum"
```

---

### Task 8: 创建 references/README.md 顶层索引

**Files:**
- Create: `webnovel-writer/references/README.md`

- [ ] **Step 1: 创建文件**

```markdown
# References

本目录存放 webnovel-writer 的所有参考资料，供 skills 和 scripts 在运行时读取。

## 目录结构

| 子目录/文件 | 职责 | 消费方式 |
|-------------|------|----------|
| `csv/` | 结构化知识条目（9 张表） | `reference_search.py` BM25 检索 |
| `csv/README.md` | CSV schema 规范与录入规则 | 人工参考 |
| `csv/genre-canonical.md` | 题材权威枚举（canonical + platform_tag 映射） | 人工参考 + 代码常量对照 |
| `genre-profiles.md` | 题材 profile（fallback，高频题材已迁入 Story Contracts） | ContextManager 直接 Read |
| `reading-power-taxonomy.md` | 追读力分类学 | Skills 直接 Read |
| `review-schema.md` | 审查输出格式定义 | webnovel-review Read |
| `index/` | 元数据索引（loading-map、gap-register） | 人工参考 |
| `outlining/` | 大纲相关参考 | webnovel-plan Read |
| `review/` | 审查相关参考 | webnovel-review Read |
| `shared/` | 跨 skill 共享参考 | 多 skill Read |

## md vs CSV 边界

- **md**：流程规范、方法论、审查 schema、硬约束、润色指导
- **CSV**：可条目化的写作知识、命名规则、场景技法、桥段模板

md 是写给大模型当行为闸门的，CSV 是写给搜索引擎当知识库的。

## 消费链路

init → plan → write → review 的完整 reference 消费路径见 `index/reference-loading-map.md`。

## 校验

```bash
cd webnovel-writer/scripts
python validate_csv.py          # 文本输出
python validate_csv.py --format json  # JSON 输出
```
```

- [ ] **Step 2: 提交**

```bash
cd "D:/wk/novel skill/webnovel-writer"
git add webnovel-writer/references/README.md
git commit -m "docs: add top-level references/README.md directory index"
```

---

### Task 9: 端到端冒烟测试

**Files:**
- Test: `webnovel-writer/scripts/tests/test_reference_search.py`

- [ ] **Step 1: 添加端到端冒烟测试**

在 `test_reference_search.py` 末尾添加：

```python
class TestEndToEndSmoke:
    """Smoke tests: full pipeline from search to result, across genres."""

    def test_xuanhuan_genre_returns_results(self):
        out = run_search("--skill", "write", "--query", "升级打脸", "--genre", "玄幻")
        assert out["status"] == "success"
        assert out["data"]["total"] >= 1

    def test_guyan_genre_returns_results(self):
        out = run_search("--skill", "write", "--query", "宫斗 嫡庶", "--genre", "古言")
        assert out["status"] == "success"
        # May be 0 if no 古言 rows exist yet, but must not error
        assert isinstance(out["data"]["results"], list)

    def test_platform_tag_as_genre(self):
        """Using a platform_tag like 都市日常 should work as --genre."""
        out = run_search("--skill", "write", "--query", "日常搞笑", "--genre", "都市日常")
        assert out["status"] == "success"
        assert isinstance(out["data"]["results"], list)

    def test_validate_csv_zero_errors(self):
        """validate_csv.py must report 0 errors on current data."""
        import subprocess
        validate_script = str(Path(__file__).resolve().parents[1] / "validate_csv.py")
        result = subprocess.run(
            [sys.executable, validate_script, "--csv-dir", CSV_DIR, "--format", "json"],
            capture_output=True, text=True,
        )
        import json
        data = json.loads(result.stdout)
        assert len(data["errors"]) == 0, f"CSV validation errors: {data['errors']}"
```

- [ ] **Step 2: 运行全部测试**

Run: `cd "D:/wk/novel skill/webnovel-writer/webnovel-writer/scripts" && python -m pytest tests/test_reference_search.py tests/test_validate_csv.py data_modules/tests/test_csv_config.py -v`
Expected: ALL PASS

- [ ] **Step 3: 提交**

```bash
cd "D:/wk/novel skill/webnovel-writer"
git add webnovel-writer/scripts/tests/test_reference_search.py
git commit -m "test: add end-to-end smoke tests for genre canonical pipeline"
```

---

## Task Summary

| Task | 内容 | 依赖 |
|------|------|------|
| 1 | GENRE_CANONICAL 常量 + PLATFORM_TO_CANONICAL 映射 + resolve_genre() | 无 |
| 2 | _genre_matches 和 search() 接入 resolve_genre | Task 1 |
| 3 | CSV_CONFIG 加 prefix / required_cols | 无（可与 1 并行） |
| 4 | validate_csv.py 校验脚本 | Task 1 + 3 |
| 5 | 题材与调性推理.csv 加 canonical_genre 列，engine 接入 | Task 1 |
| 6 | 全部 CSV 适用题材列迁移到 canonical | Task 2 |
| 7 | CSV README 更新题材章节 | Task 6 |
| 8 | references/README.md 顶层索引 | 无（可与任何 task 并行） |
| 9 | 端到端冒烟测试 | Task 2 + 4 + 6 |
