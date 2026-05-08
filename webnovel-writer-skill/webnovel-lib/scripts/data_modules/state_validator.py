#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Runtime validators/normalizers for state.json sections.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Optional, Sequence


FORESHADOWING_STATUS_PENDING = "未回收"
FORESHADOWING_STATUS_RESOLVED = "已回收"

FORESHADOWING_TIER_CORE = "核心"
FORESHADOWING_TIER_SUB = "支线"
FORESHADOWING_TIER_DECOR = "装饰"

FORESHADOWING_PLANTED_KEYS = [
    "planted_chapter",
    "added_chapter",
    "source_chapter",
    "start_chapter",
    "chapter",
]

FORESHADOWING_TARGET_KEYS = [
    "target_chapter",
    "due_chapter",
    "deadline_chapter",
    "resolve_by_chapter",
    "target",
]

_PENDING_STATUS_TEXT = {"未回收", "待回收", "进行中", "未解决", "pending", "active"}
_RESOLVED_STATUS_TEXT = {"已回收", "已完成", "已解决", "完成", "resolved", "done", "complete"}

_TIER_CORE_TEXT = {"核心", "主线", "core", "main"}
_TIER_DECOR_TEXT = {"装饰", "次要", "decor", "decoration"}

_PATTERN_FIELDS = [
    "coolpoint_patterns",
    "coolpoint_pattern",
    "cool_point_patterns",
    "cool_point_pattern",
    "patterns",
    "pattern",
]

_PATTERN_SPLIT_RE = re.compile(r"[、,，/|+；;。]+")


_PLOT_LIST_FIELDS = ("cpns", "mandatory_nodes", "prohibitions")


def _normalize_string_list(raw_value: Any) -> List[str]:
    items: List[str] = []
    if isinstance(raw_value, list):
        source = raw_value
    elif isinstance(raw_value, str):
        source = split_patterns(raw_value)
    else:
        return []

    seen = set()
    for item in source:
        text = str(item).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        items.append(text)
    return items


def to_positive_int(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None

    try:
        number = int(value)
        return number if number > 0 else None
    except (TypeError, ValueError):
        if isinstance(value, str):
            matched = re.search(r"\d+", value)
            if matched:
                number = int(matched.group(0))
                return number if number > 0 else None
    return None


def resolve_chapter_field(item: Mapping[str, Any], keys: Sequence[str]) -> Optional[int]:
    for key in keys:
        if key in item:
            chapter = to_positive_int(item.get(key))
            if chapter is not None:
                return chapter
    return None


def normalize_foreshadowing_status(
    raw_status: Any,
    default: str = FORESHADOWING_STATUS_PENDING,
) -> str:
    text = str(raw_status or "").strip()
    if not text:
        return default

    text_lower = text.lower()
    if (
        text in _RESOLVED_STATUS_TEXT
        or text_lower in _RESOLVED_STATUS_TEXT
        or FORESHADOWING_STATUS_RESOLVED in text
    ):
        return FORESHADOWING_STATUS_RESOLVED

    if text in _PENDING_STATUS_TEXT or text_lower in _PENDING_STATUS_TEXT:
        return FORESHADOWING_STATUS_PENDING

    return default


def is_resolved_foreshadowing_status(raw_status: Any) -> bool:
    return normalize_foreshadowing_status(raw_status) == FORESHADOWING_STATUS_RESOLVED


def normalize_foreshadowing_tier(
    raw_tier: Any,
    default: str = FORESHADOWING_TIER_SUB,
) -> str:
    text = str(raw_tier or "").strip()
    if not text:
        return default

    text_lower = text.lower()
    if text in _TIER_CORE_TEXT or text_lower in _TIER_CORE_TEXT:
        return FORESHADOWING_TIER_CORE
    if text in _TIER_DECOR_TEXT or text_lower in _TIER_DECOR_TEXT:
        return FORESHADOWING_TIER_DECOR
    return default


def split_patterns(raw_value: Any) -> List[str]:
    if raw_value is None:
        return []

    tokens: List[str] = []
    if isinstance(raw_value, list):
        for item in raw_value:
            text = str(item).strip()
            if text:
                tokens.append(text)
    elif isinstance(raw_value, str):
        text = raw_value.strip()
        if not text:
            return []
        split_values = [part.strip() for part in _PATTERN_SPLIT_RE.split(text)]
        tokens.extend([part for part in split_values if part])
    else:
        return []

    deduped: List[str] = []
    seen = set()
    for token in tokens:
        if token not in seen:
            seen.add(token)
            deduped.append(token)
    return deduped


def count_patterns(raw_value: Any) -> Optional[int]:
    patterns = split_patterns(raw_value)
    if not patterns:
        return None
    return len(patterns)


def normalize_foreshadowing_item(item: Mapping[str, Any]) -> Dict[str, Any]:
    normalized = dict(item)

    normalized["status"] = normalize_foreshadowing_status(item.get("status"))
    normalized["tier"] = normalize_foreshadowing_tier(item.get("tier"))

    content = str(item.get("content") or "").strip()
    if content:
        normalized["content"] = content

    planted_chapter = resolve_chapter_field(item, FORESHADOWING_PLANTED_KEYS)
    if planted_chapter is not None:
        normalized["planted_chapter"] = planted_chapter

    target_chapter = resolve_chapter_field(item, FORESHADOWING_TARGET_KEYS)
    if target_chapter is not None:
        normalized["target_chapter"] = target_chapter

    resolved_chapter = resolve_chapter_field(item, ["resolved_chapter", "resolved_at_chapter", "resolved"])
    if resolved_chapter is not None:
        normalized["resolved_chapter"] = resolved_chapter

    return normalized


def normalize_foreshadowing_list(raw_items: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw_items, list):
        return []

    normalized: List[Dict[str, Any]] = []
    for raw_item in raw_items:
        if isinstance(raw_item, Mapping):
            normalized.append(normalize_foreshadowing_item(raw_item))
    return normalized


def normalize_chapter_meta_entry(entry: Mapping[str, Any]) -> Dict[str, Any]:
    normalized = dict(entry)

    merged_patterns: List[str] = []
    seen = set()
    for field_name in _PATTERN_FIELDS:
        for pattern in split_patterns(entry.get(field_name)):
            if pattern not in seen:
                seen.add(pattern)
                merged_patterns.append(pattern)

    if merged_patterns:
        normalized["coolpoint_patterns"] = merged_patterns

    plot_structure = entry.get("plot_structure")
    if isinstance(plot_structure, Mapping):
        normalized_plot_structure = dict(plot_structure)
        cbn = str(plot_structure.get("cbn") or "").strip()
        cen = str(plot_structure.get("cen") or "").strip()
        if cbn:
            normalized_plot_structure["cbn"] = cbn
        if cen:
            normalized_plot_structure["cen"] = cen
        for field_name in _PLOT_LIST_FIELDS:
            normalized_values = _normalize_string_list(plot_structure.get(field_name))
            if normalized_values:
                normalized_plot_structure[field_name] = normalized_values
            elif field_name in normalized_plot_structure:
                normalized_plot_structure[field_name] = []
        normalized["plot_structure"] = normalized_plot_structure

    return normalized


def normalize_chapter_meta(raw_chapter_meta: Any) -> Dict[str, Dict[str, Any]]:
    if not isinstance(raw_chapter_meta, Mapping):
        return {}

    normalized: Dict[str, Dict[str, Any]] = {}
    for chapter_key, chapter_entry in raw_chapter_meta.items():
        if isinstance(chapter_entry, Mapping):
            normalized[str(chapter_key)] = normalize_chapter_meta_entry(chapter_entry)
    return normalized


def get_chapter_meta_entry(state: Mapping[str, Any], chapter: int) -> Dict[str, Any]:
    chapter_meta = state.get("chapter_meta", {})
    if not isinstance(chapter_meta, Mapping):
        return {}

    for lookup_key in (f"{chapter:04d}", str(chapter)):
        value = chapter_meta.get(lookup_key)
        if isinstance(value, Mapping):
            return normalize_chapter_meta_entry(value)

    for raw_key, raw_value in chapter_meta.items():
        if to_positive_int(raw_key) == chapter and isinstance(raw_value, Mapping):
            return normalize_chapter_meta_entry(raw_value)

    return {}


def normalize_state_runtime_sections(state: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(state, dict):
        return {}

    plot_threads = state.get("plot_threads")
    if not isinstance(plot_threads, dict):
        plot_threads = {}
        state["plot_threads"] = plot_threads
    plot_threads["foreshadowing"] = normalize_foreshadowing_list(plot_threads.get("foreshadowing"))

    state["chapter_meta"] = normalize_chapter_meta(state.get("chapter_meta", {}))
    return state

