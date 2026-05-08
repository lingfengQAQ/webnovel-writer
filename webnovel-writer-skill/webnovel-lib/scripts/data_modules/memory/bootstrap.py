#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 index.db 回填初始长期记忆。
"""
from __future__ import annotations

import re
from typing import Any, Dict

from ..config import DataModulesConfig, get_config
from ..index_manager import IndexManager
from .schema import MemoryItem
from .store import ScratchpadManager


FORESHADOWING_SECTION_RE = re.compile(r"##\s*伏笔\s*\r?\n(.*?)(?=\r?\n##|\Z)", re.DOTALL)
FORESHADOWING_BULLET_RE = re.compile(r"^\s*[-*]\s+(.+?)\s*$", re.MULTILINE)


def _extract_chapter_from_name(name: str) -> int:
    m = re.search(r"ch(\d{1,6})", name, re.IGNORECASE)
    if m:
        return int(m.group(1))
    m = re.search(r"第\s*(\d+)\s*章", name)
    if m:
        return int(m.group(1))
    return 0


def _extract_open_loops(summary_text: str) -> list[str]:
    if not summary_text:
        return []
    section_match = FORESHADOWING_SECTION_RE.search(summary_text)
    if not section_match:
        return []
    block = section_match.group(1).strip()
    if not block:
        return []
    loops = []
    for m in FORESHADOWING_BULLET_RE.finditer(block):
        text = str(m.group(1) or "").strip()
        if text:
            loops.append(text)
    return loops


def bootstrap_from_index(config: DataModulesConfig | None = None) -> Dict[str, Any]:
    cfg = config or get_config()
    idx = IndexManager(cfg)
    store = ScratchpadManager(cfg)

    created = 0
    by_category: Dict[str, int] = {}

    for entity in idx.get_entities_by_type("角色", include_archived=True):
        entity_id = str(entity.get("id", "") or "").strip()
        current = entity.get("current_json") or {}
        if not entity_id or not isinstance(current, dict):
            continue
        for field, value in current.items():
            item = MemoryItem(
                id=f"bootstrap-character_state-{entity_id}-{field}",
                layer="semantic",
                category="character_state",
                subject=entity_id,
                field=str(field),
                value=str(value),
                payload={},
                source_chapter=int(entity.get("last_appearance") or 0),
                evidence=["bootstrap:index_entities"],
            )
            store.upsert_item(item)
            created += 1
            by_category["character_state"] = by_category.get("character_state", 0) + 1

    # 回填状态变化：最新值 active，历史值 outdated。
    changes = idx.get_recent_state_changes(limit=5000)
    changes_sorted = sorted(
        changes,
        key=lambda x: (int(x.get("chapter") or 0), int(x.get("id") or 0)),
    )
    latest_by_key: Dict[tuple[str, str], Dict[str, Any]] = {}
    history_rows: list[Dict[str, Any]] = []
    for row in changes_sorted:
        entity_id = str(row.get("entity_id", "") or "").strip()
        field = str(row.get("field", "") or "").strip()
        if not entity_id or not field:
            continue
        key = (entity_id, field)
        if key in latest_by_key:
            history_rows.append(latest_by_key[key])
        latest_by_key[key] = row

    for row in history_rows:
        entity_id = str(row.get("entity_id", "") or "").strip()
        field = str(row.get("field", "") or "").strip()
        ch = int(row.get("chapter") or 0)
        val = str(row.get("new_value", "") or "")
        if not entity_id or not field or not val:
            continue
        item = MemoryItem(
            id=f"bootstrap-state-{entity_id}-{field}-{ch}",
            layer="semantic",
            category="character_state",
            subject=entity_id,
            field=field,
            value=val,
            payload={"old_value": str(row.get("old_value", "") or ""), "reason": str(row.get("reason", "") or "")},
            status="outdated",
            source_chapter=ch,
            evidence=["bootstrap:index_state_changes"],
        )
        store.upsert_item(item)
        created += 1
        by_category["character_state"] = by_category.get("character_state", 0) + 1

    for (entity_id, field), row in latest_by_key.items():
        ch = int(row.get("chapter") or 0)
        val = str(row.get("new_value", "") or "")
        if not val:
            continue
        item = MemoryItem(
            id=f"bootstrap-state-latest-{entity_id}-{field}",
            layer="semantic",
            category="character_state",
            subject=entity_id,
            field=field,
            value=val,
            payload={"old_value": str(row.get("old_value", "") or ""), "reason": str(row.get("reason", "") or "")},
            status="active",
            source_chapter=ch,
            evidence=["bootstrap:index_state_changes_latest"],
        )
        store.upsert_item(item)
        created += 1
        by_category["character_state"] = by_category.get("character_state", 0) + 1

    for rel in idx.get_recent_relationships(limit=500):
        from_entity = str(rel.get("from_entity", "") or "").strip()
        to_entity = str(rel.get("to_entity", "") or "").strip()
        if not from_entity or not to_entity:
            continue
        item = MemoryItem(
            id=f"bootstrap-relationship-{from_entity}-{to_entity}",
            layer="semantic",
            category="relationship",
            subject=from_entity,
            field=to_entity,
            value=str(rel.get("type", "") or ""),
            payload={"description": rel.get("description", "")},
            source_chapter=int(rel.get("chapter") or 0),
            evidence=["bootstrap:index_relationships"],
        )
        store.upsert_item(item)
        created += 1
        by_category["relationship"] = by_category.get("relationship", 0) + 1

    # 从 summaries 中抽取“伏笔”区块回填 open_loop。
    summaries_dir = cfg.webnovel_dir / "summaries"
    if summaries_dir.exists():
        for path in sorted(summaries_dir.glob("*.md")):
            text = path.read_text(encoding="utf-8")
            chapter = _extract_chapter_from_name(path.stem)
            for idx_loop, loop in enumerate(_extract_open_loops(text), start=1):
                item = MemoryItem(
                    id=f"bootstrap-open-loop-{chapter}-{idx_loop}",
                    layer="semantic",
                    category="open_loop",
                    subject=loop[:64],
                    field="status",
                    value=loop,
                    payload={"planted_chapter": chapter, "urgency": 50, "status": "active"},
                    status="active",
                    source_chapter=chapter,
                    evidence=["bootstrap:summaries_foreshadowing"],
                )
                store.upsert_item(item)
                created += 1
                by_category["open_loop"] = by_category.get("open_loop", 0) + 1

    return {"items_created": created, "categories": by_category}
