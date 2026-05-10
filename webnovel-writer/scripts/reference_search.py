#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Reference CSV 检索工具。

在 references/csv/ 目录下的 CSV 文件中执行 BM25 关键词搜索，
支持按技能、题材过滤，返回 JSON 格式结果。

用法:
    python reference_search.py --skill write --query "角色命名" --genre 玄幻
    python reference_search.py --skill write --table 命名规则 --query "战斗描写" --max-results 3
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# CSV loading
# ---------------------------------------------------------------------------

def _load_csv(path: Path) -> List[Dict[str, str]]:
    """Load a single CSV file (UTF-8 with BOM)."""
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return list(reader)


def load_tables(csv_dir: Path, table: Optional[str] = None) -> Dict[str, List[Dict[str, str]]]:
    """
    Load CSV tables from *csv_dir*.

    If *table* is given, load only that file (``<table>.csv``).
    Otherwise load every ``.csv`` file in the directory.

    Returns ``{table_name: [row_dict, ...]}``.
    """
    tables: Dict[str, List[Dict[str, str]]] = {}
    if table:
        target = csv_dir / f"{table}.csv"
        if target.is_file():
            tables[table] = _load_csv(target)
    else:
        for p in sorted(csv_dir.glob("*.csv")):
            tables[p.stem] = _load_csv(p)
    return tables


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------

_MULTI_VALUE_SPLIT_RE = re.compile(r"[|,，、；;]+")
_INTERNAL_TABLE_ROLES = {"route", "reasoning"}


def split_multi_value(cell: Any) -> List[str]:
    """Split list-like cells while remaining compatible with legacy comma data."""
    if not cell:
        return []
    return [part.strip() for part in _MULTI_VALUE_SPLIT_RE.split(str(cell)) if part.strip()]


def _split_multi_value(cell: Any) -> List[str]:
    return split_multi_value(cell)


def _skill_matches(row: Dict[str, str], skill: str) -> bool:
    """Return True if *skill* appears in the pipe-separated ``适用技能`` column."""
    return skill in _split_multi_value(row.get("适用技能", ""))


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
    requested_genres = [
        resolved
        for raw in _split_multi_value(genre)
        for resolved in [resolve_genre(raw)]
        if resolved
    ]
    cell_genres = [resolve_genre(v) for v in _split_multi_value(cell)]
    return any(resolved in cell_genres for resolved in requested_genres)


def _table_visible_for_search(table_name: str, skill: str, explicit_table: bool) -> bool:
    """Keep story-system internals out of normal cross-table skill searches."""
    if explicit_table or skill == "story-system":
        return True
    cfg = CSV_CONFIG.get(table_name) or {}
    return cfg.get("role") not in _INTERNAL_TABLE_ROLES


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
# Used by resolve_genre() during the migration period.
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


# ---------------------------------------------------------------------------
# CSV_CONFIG – per-table metadata registry
# ---------------------------------------------------------------------------

CSV_CONFIG: Dict[str, Dict[str, Any]] = {
    "命名规则": {
        "file": "命名规则.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "命名对象", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "base",
        "contract_inject": "MASTER_SETTING.base_context",
        "prefix": "NR",
        "required_cols": ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要"],
    },
    "场景写法": {
        "file": "场景写法.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "模式名称", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "base",
        "contract_inject": "CHAPTER_BRIEF.dynamic_context",
        "prefix": "SP",
        "required_cols": ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要"],
    },
    "写作技法": {
        "file": "写作技法.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "技法名称", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "base",
        "contract_inject": "CHAPTER_BRIEF.dynamic_context",
        "prefix": "WT",
        "required_cols": ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要"],
    },
    "桥段套路": {
        "file": "桥段套路.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "桥段名称", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "dynamic",
        "contract_inject": "CHAPTER_BRIEF.dynamic_context",
        "prefix": "TR",
        "required_cols": ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要"],
    },
    "爽点与节奏": {
        "file": "爽点与节奏.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "节奏类型", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "dynamic",
        "contract_inject": "CHAPTER_BRIEF.dynamic_context",
        "prefix": "PA",
        "required_cols": ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要"],
    },
    "人设与关系": {
        "file": "人设与关系.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "人设类型", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "base",
        "contract_inject": "MASTER_SETTING.base_context",
        "prefix": "CH",
        "required_cols": ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要"],
    },
    "金手指与设定": {
        "file": "金手指与设定.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "核心摘要": 2},
        "output_cols": ["编号", "设定类型", "核心摘要", "大模型指令", "详细展开"],
        "poison_col": "毒点",
        "role": "base",
        "contract_inject": "MASTER_SETTING.base_context",
        "prefix": "SY",
        "required_cols": ["编号", "适用技能", "分类", "层级", "关键词", "适用题材", "核心摘要"],
    },
    "题材与调性推理": {
        "file": "题材与调性推理.csv",
        "search_cols": {"关键词": 3, "意图与同义词": 4, "题材别名": 3},
        "output_cols": ["编号", "题材/流派", "canonical_genre", "核心调性", "推荐基础检索表", "推荐动态检索表"],
        "poison_col": "毒点",
        "role": "route",
        "contract_inject": "MASTER_SETTING.route",
        "prefix": "GR",
        "required_cols": ["编号", "适用技能", "题材/流派", "canonical_genre", "核心调性", "推荐基础检索表", "推荐动态检索表"],
    },
    "裁决规则": {
        "file": "裁决规则.csv",
        "search_cols": {"题材": 4},
        "output_cols": ["题材", "风格优先级", "爽点优先级", "节奏默认策略",
                        "毒点权重", "冲突裁决", "contract注入层", "反模式"],
        "poison_col": "",
        "role": "reasoning",
        "contract_inject": "CHAPTER_BRIEF.writing_guidance",
        "prefix": "RS",
        "required_cols": ["编号", "题材", "风格优先级", "爽点优先级", "节奏默认策略", "冲突裁决"],
    },
}

# ---------------------------------------------------------------------------
# BM25-lite scoring
# ---------------------------------------------------------------------------

_TOKEN_SPLIT_RE = re.compile(r"[\s|,，、/；;：:（）()【】\[\]<>《》""\"'''!?！？。…]+")
_DEFAULT_SEARCH_WEIGHTS = {
    "意图与同义词": 4,
    "关键词": 3,
    "核心摘要": 2,
    "详细展开": 1,
}


def _tokenize(text: str) -> List[str]:
    """Split text into reusable search terms without requiring a segmenter."""
    if not text:
        return []
    tokens: List[str] = []
    for part in _TOKEN_SPLIT_RE.split(text):
        token = part.strip()
        if not token:
            continue
        # 过滤 don't -> t 这类单字符英文噪声，避免触发子串兜底误召回。
        if len(token) == 1 and token.isascii():
            continue
        tokens.append(token)
    return tokens


def _build_doc_terms(row: Dict[str, str], search_weights: Optional[Dict[str, int]] = None) -> List[str]:
    """Build weighted BM25 terms from the configured search fields."""
    weights = search_weights or _DEFAULT_SEARCH_WEIGHTS
    terms: List[str] = []
    for field, weight in weights.items():
        field_terms = _tokenize(row.get(field, ""))
        if not field_terms:
            continue
        terms.extend(field_terms * weight)
    return terms


def _bm25_score(query_terms: List[str], doc_terms: List[str],
                avg_dl: float, k1: float = 1.5, b: float = 0.75,
                idf_map: Optional[Dict[str, float]] = None) -> float:
    """
    Simplified BM25 score for a single document.

    *idf_map* maps each query term to its IDF value.
    """
    if not doc_terms:
        return 0.0
    dl = len(doc_terms)
    score = 0.0
    tf_map: Dict[str, int] = {}
    for t in doc_terms:
        tf_map[t] = tf_map.get(t, 0) + 1
    for qt in query_terms:
        tf = tf_map.get(qt, 0)
        if tf == 0:
            # Also check substring match (important for Chinese compound words)
            for dt in tf_map:
                if qt in dt or dt in qt:
                    tf = max(tf, 1)
                    break
        if tf == 0:
            continue
        idf = idf_map.get(qt, 1.0) if idf_map else 1.0
        numerator = tf * (k1 + 1)
        denominator = tf + k1 * (1 - b + b * dl / max(avg_dl, 1))
        score += idf * numerator / denominator
    return score


def _compute_idf(query_terms: List[str], all_docs: List[List[str]]) -> Dict[str, float]:
    """Compute IDF for each query term across all documents."""
    n = len(all_docs)
    if n == 0:
        return {}
    idf: Dict[str, float] = {}
    for qt in query_terms:
        df = 0
        for doc in all_docs:
            for dt in doc:
                if qt in dt or dt in qt:
                    df += 1
                    break
        # BM25 IDF: log((N - df + 0.5) / (df + 0.5) + 1)
        idf[qt] = math.log((n - df + 0.5) / (df + 0.5) + 1)
    return idf


# ---------------------------------------------------------------------------
# Content summary builder
# ---------------------------------------------------------------------------

# Hardcoded fallback columns when no CSV_CONFIG entry exists.
_FALLBACK_CONTENT_COLUMNS = [
    "技法名称", "桥段名称", "人设类型", "节奏类型", "设定类型",
    "规则", "说明", "模式名称",
    "常见误区", "前置铺垫", "核心爽点", "转折设计",
    "核心动机", "行为逻辑", "互动模式", "忌讳写法",
    "情绪调动手法", "常见崩盘误区",
    "数值控制边界", "与剧情交互方式",
    "正例", "示例片段",
    "反例", "反面写法",
    "命名对象", "场景类型", "技法类型", "适用场景",
]

_SUMMARY_SKIP_COLS = {"编号", "大模型指令", "详细展开", "核心摘要"}


def _build_summary(row: Dict[str, str], table_name: Optional[str] = None) -> str:
    """Merge key content columns into a single summary string."""
    core_summary = row.get("核心摘要", "").strip()
    if core_summary:
        return core_summary

    # Derive fallback columns from CSV_CONFIG if available
    tbl_cfg = CSV_CONFIG.get(table_name) if table_name else None
    if tbl_cfg:
        cols = [c for c in tbl_cfg["output_cols"] if c not in _SUMMARY_SKIP_COLS]
    else:
        cols = _FALLBACK_CONTENT_COLUMNS

    parts: List[str] = []
    for col in cols:
        val = row.get(col, "").strip()
        if val:
            parts.append(val)
    if parts:
        return "；".join(parts)
    return row.get("详细展开", "").strip()


# ---------------------------------------------------------------------------
# Search entry point
# ---------------------------------------------------------------------------

def search(
    csv_dir: Path,
    skill: str,
    query: str,
    table: Optional[str] = None,
    genre: Optional[str] = None,
    max_results: int = 5,
) -> Dict[str, Any]:
    """
    Run a BM25 keyword search across CSV reference tables.

    Returns a result dict suitable for JSON serialisation.
    """
    resolved = resolve_genre(genre)

    if not csv_dir.is_dir():
        return {
            "status": "error",
            "error": {
                "code": "CSV_DIR_NOT_FOUND",
                "message": f"CSV directory not found: {csv_dir}",
            },
        }

    tables = load_tables(csv_dir, table=table)
    if not tables:
        return {
            "status": "success",
            "message": "search_results",
            "data": {
                "query": query,
                "skill": skill,
                "genre": genre,
                "total": 0,
                "results": [],
            },
        }

    # 1) Collect filtered rows with table name annotation
    candidates: List[tuple] = []  # (table_name, row)
    for tbl_name, rows in tables.items():
        if not _table_visible_for_search(tbl_name, skill, explicit_table=table is not None):
            continue
        for row in rows:
            if _skill_matches(row, skill) and _genre_matches(row, resolved):
                candidates.append((tbl_name, row))

    if not candidates:
        return {
            "status": "success",
            "message": "search_results",
            "data": {
                "query": query,
                "skill": skill,
                "genre": genre,
                "total": 0,
                "results": [],
            },
        }

    # 2) Tokenize
    query_terms = _tokenize(query)
    doc_terms_list = []
    for tbl_name, row in candidates:
        tbl_cfg = CSV_CONFIG.get(tbl_name)
        weights = dict(tbl_cfg["search_cols"]) if tbl_cfg else None
        doc_terms_list.append(_build_doc_terms(row, weights))
    avg_dl = sum(len(d) for d in doc_terms_list) / len(doc_terms_list) if doc_terms_list else 1.0
    idf_map = _compute_idf(query_terms, doc_terms_list)

    # 3) Score
    scored: List[tuple] = []
    for idx, (tbl_name, row) in enumerate(candidates):
        score = _bm25_score(query_terms, doc_terms_list[idx], avg_dl, idf_map=idf_map)
        if score > 0:
            scored.append((score, tbl_name, row))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:max_results]

    # 4) Format results
    results: List[Dict[str, Any]] = []
    for _score, tbl_name, row in top:
        results.append({
            "编号": row.get("编号", ""),
            "表": tbl_name,
            "分类": row.get("分类", ""),
            "层级": row.get("层级", ""),
            "适用题材": row.get("适用题材", ""),
            "内容摘要": _build_summary(row, table_name=tbl_name),
            "大模型指令": row.get("大模型指令", "").strip(),
        })

    return {
        "status": "success",
        "message": "search_results",
        "data": {
            "query": query,
            "skill": skill,
            "genre": genre,
            "total": len(results),
            "results": results,
        },
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _default_csv_dir() -> Path:
    """Auto-detect the csv directory relative to this script's location."""
    return Path(__file__).resolve().parent.parent / "references" / "csv"


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(
        description="BM25 keyword search over reference CSV files",
    )
    parser.add_argument("--skill", required=True, help="Filter by 适用技能 column")
    parser.add_argument("--table", default=None, help="Target specific CSV file name (without .csv)")
    parser.add_argument("--query", required=True, help="BM25 search keywords")
    parser.add_argument("--genre", default=None, help="Filter by 适用题材 column")
    parser.add_argument("--max-results", type=int, default=5, help="Max results (default 5)")
    parser.add_argument("--csv-dir", default=None, help="Override CSV directory path")

    args = parser.parse_args(argv)
    csv_dir = Path(args.csv_dir) if args.csv_dir else _default_csv_dir()

    result = search(
        csv_dir=csv_dir,
        skill=args.skill,
        query=args.query,
        table=args.table,
        genre=args.genre,
        max_results=args.max_results,
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
