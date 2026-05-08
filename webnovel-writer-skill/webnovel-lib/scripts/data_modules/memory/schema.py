#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
长期记忆 schema 定义。
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Dict, List


VALID_LAYERS = {"semantic", "episodic"}
VALID_STATUSES = {"active", "outdated", "contradicted", "tentative"}

CATEGORY_TO_BUCKET: Dict[str, str] = {
    "character_state": "character_state",
    "story_fact": "story_facts",
    "world_rule": "world_rules",
    "timeline": "timeline",
    "open_loop": "open_loops",
    "reader_promise": "reader_promises",
    "relationship": "relationships",
}
BUCKET_TO_CATEGORY: Dict[str, str] = {v: k for k, v in CATEGORY_TO_BUCKET.items()}

CATEGORY_KEY_RULES: Dict[str, tuple[str, ...]] = {
    "character_state": ("subject", "field"),
    "relationship": ("subject", "field"),
    "world_rule": ("subject", "field"),
    "story_fact": ("subject", "field"),
    "timeline": ("subject", "source_chapter"),
    "open_loop": ("subject",),
    "reader_promise": ("subject",),
}


def memory_item_key(item: "MemoryItem") -> tuple:
    """根据 category 规则计算 MemoryItem 的去重 key。供 store/compactor 共用。"""
    fields = CATEGORY_KEY_RULES.get(item.category)
    if not fields:
        return (item.id,)
    return tuple(getattr(item, f, None) for f in fields)


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


@dataclass
class MemoryItem:
    id: str
    layer: str
    category: str
    subject: str
    field: str
    value: str
    payload: Dict[str, Any] = field(default_factory=dict)
    status: str = "active"
    source_chapter: int = 0
    evidence: List[str] = field(default_factory=list)
    updated_at: str = ""

    def normalized(self) -> "MemoryItem":
        layer = self.layer if self.layer in VALID_LAYERS else "semantic"
        category = self.category if self.category in CATEGORY_TO_BUCKET else "story_fact"
        status = self.status if self.status in VALID_STATUSES else "active"
        updated_at = self.updated_at or now_iso()
        return MemoryItem(
            id=str(self.id or ""),
            layer=layer,
            category=category,
            subject=str(self.subject or ""),
            field=str(self.field or ""),
            value=str(self.value or ""),
            payload=dict(self.payload or {}),
            status=status,
            source_chapter=int(self.source_chapter or 0),
            evidence=[str(x) for x in (self.evidence or []) if str(x)],
            updated_at=updated_at,
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self.normalized())

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "MemoryItem":
        return cls(
            id=str(payload.get("id", "")),
            layer=str(payload.get("layer", "semantic")),
            category=str(payload.get("category", "story_fact")),
            subject=str(payload.get("subject", "")),
            field=str(payload.get("field", "")),
            value=str(payload.get("value", "")),
            payload=dict(payload.get("payload") or {}),
            status=str(payload.get("status", "active")),
            source_chapter=int(payload.get("source_chapter", 0) or 0),
            evidence=[str(x) for x in (payload.get("evidence") or []) if str(x)],
            updated_at=str(payload.get("updated_at", "")),
        ).normalized()


@dataclass
class ScratchpadData:
    character_state: List[MemoryItem] = field(default_factory=list)
    story_facts: List[MemoryItem] = field(default_factory=list)
    world_rules: List[MemoryItem] = field(default_factory=list)
    timeline: List[MemoryItem] = field(default_factory=list)
    open_loops: List[MemoryItem] = field(default_factory=list)
    reader_promises: List[MemoryItem] = field(default_factory=list)
    relationships: List[MemoryItem] = field(default_factory=list)
    meta: Dict[str, Any] = field(
        default_factory=lambda: {"version": 1, "last_updated": "", "total_items": 0}
    )

    @classmethod
    def empty(cls) -> "ScratchpadData":
        return cls()

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "ScratchpadData":
        def _items(bucket: str) -> List[MemoryItem]:
            rows = payload.get(bucket, [])
            if not isinstance(rows, list):
                return []
            return [MemoryItem.from_dict(row) for row in rows if isinstance(row, dict)]

        data = cls(
            character_state=_items("character_state"),
            story_facts=_items("story_facts"),
            world_rules=_items("world_rules"),
            timeline=_items("timeline"),
            open_loops=_items("open_loops"),
            reader_promises=_items("reader_promises"),
            relationships=_items("relationships"),
            meta=dict(payload.get("meta") or {}),
        )
        data.meta.setdefault("version", 1)
        data.meta.setdefault("last_updated", "")
        data.meta.setdefault("total_items", 0)
        data.meta["total_items"] = data.count_items()
        return data

    def count_items(self) -> int:
        return sum(
            len(getattr(self, bucket))
            for bucket in BUCKET_TO_CATEGORY
        )

    def to_dict(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {}
        for bucket in BUCKET_TO_CATEGORY:
            result[bucket] = [item.to_dict() for item in getattr(self, bucket)]
        meta = dict(self.meta or {})
        meta["version"] = int(meta.get("version", 1) or 1)
        meta["last_updated"] = meta.get("last_updated") or now_iso()
        meta["total_items"] = self.count_items()
        result["meta"] = meta
        return result

