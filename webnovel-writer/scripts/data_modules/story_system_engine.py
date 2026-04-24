#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from reference_search import CSV_CONFIG, GENRE_CANONICAL, resolve_genre, search as search_reference

from .story_contracts import merge_anti_patterns


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

_TEXT_TOKEN_RE = re.compile(r"[\s|,，、/；;：:（）()【】\[\]<>《》\"'!?！？。…]+")


class StorySystemEngine:
    def __init__(self, csv_dir: str | Path):
        self.csv_dir = Path(csv_dir)

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

        # Reasoning layer — try routed genre first, then original genre
        canonical_genre = str(route.get("meta", {}).get("canonical_genre", "") or "").strip()
        reasoning = self._load_reasoning(canonical_genre)
        if not reasoning and genre:
            fallback_genre = resolve_genre(genre) or genre
            if fallback_genre != canonical_genre:
                reasoning = self._load_reasoning(fallback_genre)
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
                    "reasoning": (
                        {
                            "genre": reasoning.get("题材", ""),
                            "inject_target": self._reasoning_inject_target(reasoning),
                            "style_priority": reasoning.get("风格优先级", ""),
                            "pacing_strategy": reasoning.get("节奏默认策略", ""),
                        }
                        if reasoning
                        else {}
                    ),
                }
                if chapter is not None
                else None
            ),
            "anti_patterns": anti_patterns,
        }

    def _route(self, query: str, genre: Optional[str]) -> Dict[str, Any]:
        route_rows = self._load_csv_rows("题材与调性推理")
        query_text = self._normalize_text(" ".join([query or "", genre or ""]))
        inferred_canonical = "" if genre else self._infer_genre_from_text(query)

        matched = None
        route_source = "empty_csv_fallback"
        for row in route_rows:
            aliases = (
                self._split_multi_value(row.get("关键词"))
                + self._split_multi_value(row.get("意图与同义词"))
                + self._split_multi_value(row.get("题材别名"))
            )
            if any(alias and self._normalize_text(alias) in query_text for alias in aliases):
                matched = row
                route_source = "keyword_or_alias_match"
                break
        if matched is None and genre:
            matched = self._fallback_row_for_genre(route_rows, genre)
            if matched is not None:
                route_source = "explicit_genre_fallback"
        if matched is None and inferred_canonical:
            matched = self._fallback_row_for_genre(route_rows, inferred_canonical)
            if matched is not None:
                route_source = "inferred_genre_fallback"
        if matched is None and route_rows:
            matched = route_rows[0]
            route_source = "default_seed_fallback"
        if matched is None:
            return self._empty_route(query=query, genre=genre)

        primary_genre = str(matched.get("题材/流派") or genre or "").strip()
        explicit_canonical = resolve_genre(genre)
        canonical_genre = str(matched.get("canonical_genre") or "").strip()
        row_canonicals = [
            resolved
            for raw in self._split_multi_value(matched.get("适用题材"))
            for resolved in [resolve_genre(raw) or str(raw or "").strip()]
            if resolved and resolved != "全部"
        ]
        if explicit_canonical and explicit_canonical != "全部":
            if not row_canonicals or explicit_canonical in row_canonicals or canonical_genre in ("", "全部"):
                canonical_genre = explicit_canonical
        elif inferred_canonical and inferred_canonical != "全部":
            if not row_canonicals or inferred_canonical in row_canonicals or canonical_genre in ("", "全部"):
                canonical_genre = inferred_canonical
        if not canonical_genre:
            resolved_primary = resolve_genre(primary_genre)
            if resolved_primary in GENRE_CANONICAL:
                canonical_genre = resolved_primary
            elif explicit_canonical and explicit_canonical != "全部":
                canonical_genre = explicit_canonical
        genre_filter = canonical_genre if canonical_genre not in ("", "全部") else ""
        return {
            "meta": {
                "primary_genre": primary_genre,
                "canonical_genre": canonical_genre,
                "route_source": route_source,
                "genre_filter": genre_filter,
                "recommended_base_tables": self._split_multi_value(matched.get("推荐基础检索表")),
                "recommended_dynamic_tables": self._split_multi_value(matched.get("推荐动态检索表")),
            },
            "core_tone": str(matched.get("核心调性") or "").strip(),
            "pacing_strategy": str(matched.get("节奏策略") or "").strip(),
            "route_anti_patterns": self._extract_route_anti_patterns(matched),
            "recommended_base_tables": self._split_multi_value(matched.get("推荐基础检索表")),
            "recommended_dynamic_tables": self._split_multi_value(matched.get("推荐动态检索表")),
            "genre_filter": genre_filter,
            "default_query": str(matched.get("默认查询词") or "").strip(),
            "source_trace": [{"table": "题材与调性推理", "id": matched.get("编号", ""), "reason": route_source}],
        }

    def _collect_tables(self, query: str, tables: List[str], genre: str, top_k: int) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for table_name in tables:
            result = search_reference(
                csv_dir=self.csv_dir,
                skill="write",
                query=query,
                table=table_name,
                genre=genre or None,
                max_results=top_k,
            )
            raw_rows = {str(row.get("编号") or ""): row for row in self._load_csv_rows(table_name)}
            for item in result.get("data", {}).get("results", []):
                row_id = str(item.get("编号") or "")
                full_row = dict(raw_rows.get(row_id) or {})
                full_row["_table"] = str(item.get("表") or table_name)
                full_row["编号"] = row_id
                full_row["核心摘要"] = str(
                    full_row.get("核心摘要")
                    or item.get("内容摘要")
                    or item.get("核心摘要")
                    or ""
                ).strip()
                rows.append(full_row)
        return rows

    def _extract_anti_patterns(self, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        extracted: List[Dict[str, Any]] = []
        for row in rows:
            table_name = str(row.get("_table") or "")
            for field_name in ANTI_PATTERN_SOURCE_FIELDS.get(table_name, []):
                for text in self._split_multi_value(row.get(field_name)):
                    extracted.append(
                        {
                            "text": text,
                            "source_table": table_name,
                            "source_id": row.get("编号", ""),
                        }
                    )
        return extracted

    def _suggest_chapter_focus(self, query: str, dynamic_rows: List[Dict[str, Any]]) -> str:
        for row in dynamic_rows:
            summary = str(row.get("核心摘要") or "").strip()
            if summary:
                return summary
        return query

    def _build_source_trace(self, *groups: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        trace: List[Dict[str, Any]] = []
        for group in groups:
            for row in group:
                trace.append(
                    {
                        "table": row.get("_table", ""),
                        "id": row.get("编号", ""),
                        "summary": row.get("核心摘要", ""),
                    }
                )
        return trace

    def _load_csv_rows(self, table_name: str) -> List[Dict[str, Any]]:
        csv_path = self.csv_dir / f"{table_name}.csv"
        if not csv_path.is_file():
            return []
        with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
            return list(csv.DictReader(f))

    def _normalize_text(self, text: str) -> str:
        return str(text or "").strip().lower()

    def _split_multi_value(self, raw: Any) -> List[str]:
        return [item.strip() for item in re.split(r"[|；;]+", str(raw or "")) if item.strip()]

    def _expand_query(self, query: str, default_query: str) -> str:
        items: List[str] = []
        for candidate in [query, *self._split_multi_value(default_query)]:
            text = str(candidate or "").strip()
            if text and text not in items:
                items.append(text)
        return " ".join(items)

    def _fallback_row_for_genre(self, rows: List[Dict[str, Any]], genre: str) -> Dict[str, Any] | None:
        genre_text = self._normalize_text(resolve_genre(genre) or genre)
        for row in rows:
            candidates = (
                self._split_multi_value(row.get("适用题材"))
                + self._split_multi_value(row.get("题材/流派"))
                + self._split_multi_value(row.get("canonical_genre"))
            )
            if any(self._normalize_text(candidate) == genre_text for candidate in candidates):
                return row
        return None

    def _infer_genre_from_text(self, text: str) -> str:
        """Infer a canonical genre from plain query text before default routing."""
        raw_text = str(text or "")
        tokens = [token.strip() for token in _TEXT_TOKEN_RE.split(raw_text) if token.strip()]
        for candidate in tokens:
            resolved = resolve_genre(candidate)
            if resolved in GENRE_CANONICAL:
                return resolved or ""

        normalized = self._normalize_text(raw_text)
        for canonical in sorted(GENRE_CANONICAL, key=len, reverse=True):
            if self._normalize_text(canonical) in normalized:
                return canonical
        return ""

    def _extract_route_anti_patterns(self, row: Dict[str, Any]) -> List[Dict[str, Any]]:
        return [
            {"text": text, "source_table": "题材与调性推理", "source_id": row.get("编号", "")}
            for text in self._split_multi_value(row.get("毒点"))
        ]

    # ------------------------------------------------------------------
    # Reasoning / 裁决 layer
    # ------------------------------------------------------------------

    def _load_reasoning(self, genre: str) -> Dict[str, Any]:
        """Load matching row from 裁决规则.csv for *genre*."""
        rows = self._load_csv_rows("裁决规则")
        genre_norm = self._normalize_text(genre)
        if not genre_norm:
            return {}
        for row in rows:
            if self._normalize_text(row.get("题材")) == genre_norm:
                return row
            aliases = (
                self._split_multi_value(row.get("关键词"))
                + self._split_multi_value(row.get("意图与同义词"))
            )
            if any(genre_norm == self._normalize_text(a) for a in aliases):
                return row
        return {}

    def _apply_reasoning(
        self,
        reasoning: Dict[str, Any],
        base_context: List[Dict[str, Any]],
        dynamic_context: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """Rank *base_context* + *dynamic_context* rows using 冲突裁决 priority."""
        combined = [dict(r) for r in base_context] + [dict(r) for r in dynamic_context]
        if not reasoning:
            return combined

        priority_order = [
            s.strip()
            for s in str(reasoning.get("冲突裁决") or "").split(">")
            if s.strip()
        ]
        priority_map = {name: idx for idx, name in enumerate(priority_order)}

        genre_label = reasoning.get("题材", "")
        for row in combined:
            table = str(row.get("_table") or "")
            row["_priority_rank"] = priority_map.get(table, 999)
            row["_reasoning_rule"] = genre_label

        combined.sort(key=lambda r: r["_priority_rank"])
        return combined

    def _rank_anti_patterns(
        self,
        reasoning: Dict[str, Any],
        anti_patterns: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """Sort *anti_patterns* by 毒点权重 and append reasoning 反模式."""
        if not reasoning:
            return anti_patterns

        weight_order = [
            s.strip()
            for s in str(reasoning.get("毒点权重") or "").split(">")
            if s.strip()
        ]

        def _sort_key(item: Dict[str, Any]) -> int:
            text = str(item.get("text") or "")
            for idx, keyword in enumerate(weight_order):
                if keyword in text:
                    return idx
            return len(weight_order)

        sorted_anti = sorted(anti_patterns, key=_sort_key)

        # Append 反模式 entries from reasoning row
        existing_texts = {str(a.get("text") or "") for a in sorted_anti}
        for text in self._split_multi_value(reasoning.get("反模式")):
            if text and text not in existing_texts:
                sorted_anti.append(
                    {"text": text, "source_table": "裁决规则", "source_id": reasoning.get("编号", "")}
                )
                existing_texts.add(text)

        return sorted_anti

    def _build_source_trace_with_reasoning(
        self,
        ranked: List[Dict[str, Any]],
        reasoning: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """Build source trace entries enriched with reasoning metadata."""
        inject_target = self._reasoning_inject_target(reasoning)
        trace: List[Dict[str, Any]] = []
        for row in ranked:
            trace.append(
                {
                    "table": row.get("_table", ""),
                    "id": row.get("编号", ""),
                    "summary": row.get("核心摘要", ""),
                    "reasoning_rule": row.get("_reasoning_rule", ""),
                    "priority_rank": row.get("_priority_rank", 999),
                    "inject_target": inject_target,
                }
            )
        return trace

    def _reasoning_inject_target(self, reasoning: Dict[str, Any]) -> str:
        if reasoning:
            explicit = str(reasoning.get("contract注入层") or "").strip()
            if explicit:
                return explicit
        cfg = CSV_CONFIG.get("裁决规则") or {}
        return str(cfg.get("contract_inject") or "")

    def _empty_route(self, query: str, genre: Optional[str]) -> Dict[str, Any]:
        fallback_genre = str(genre or "未命中题材").strip()
        resolved_explicit = resolve_genre(genre)
        canonical_genre = resolved_explicit if resolved_explicit not in (None, "全部") else ""
        route_source = "explicit_genre_fallback" if genre else "empty_csv_fallback"
        return {
            "meta": {
                "primary_genre": fallback_genre,
                "canonical_genre": canonical_genre,
                "route_source": route_source,
                "genre_filter": canonical_genre,
                "recommended_base_tables": ["命名规则", "人设与关系"],
                "recommended_dynamic_tables": ["桥段套路", "爽点与节奏", "场景写法"],
            },
            "core_tone": "",
            "pacing_strategy": "",
            "route_anti_patterns": [],
            "recommended_base_tables": ["命名规则", "人设与关系"],
            "recommended_dynamic_tables": ["桥段套路", "爽点与节奏", "场景写法"],
            "genre_filter": canonical_genre,
            "default_query": "",
            "source_trace": [{"table": "题材与调性推理", "id": "", "reason": f"{route_source}:{query}"}],
        }
