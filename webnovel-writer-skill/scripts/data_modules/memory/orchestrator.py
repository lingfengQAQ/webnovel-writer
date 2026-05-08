#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
长期记忆编排器。
"""
from __future__ import annotations

import json
from typing import Any, Dict, List

from ..config import DataModulesConfig, get_config
from ..index_manager import IndexManager
from .schema import MemoryItem
from .store import ScratchpadManager
from .budget import allocate_limits

try:
    from chapter_outline_loader import load_chapter_outline
except ImportError:  # pragma: no cover
    from scripts.chapter_outline_loader import load_chapter_outline


class MemoryOrchestrator:
    PRIORITY = {
        "world_rule": 0,
        "character_state": 1,
        "relationship": 2,
        "story_fact": 3,
        "open_loop": 4,
        "reader_promise": 5,
        "timeline": 6,
    }

    def __init__(self, config: DataModulesConfig | None = None):
        self.config = config or get_config()
        self.index_manager = IndexManager(self.config)
        self.store = ScratchpadManager(self.config)

    def build_memory_pack(self, chapter: int, task_type: str = "write") -> Dict[str, Any]:
        outline = load_chapter_outline(self.config.project_root, chapter, max_chars=1500)

        working = self._build_working_memory(chapter=chapter, outline=outline)
        episodic = self._build_episodic_memory(chapter=chapter)
        active_items = self.store.query(status="active")
        conflicts = self.store.conflicts()
        filtered = self._filter_relevant(active_items, chapter=chapter, outline=outline)

        max_items = max(1, int(getattr(self.config, "memory_orchestrator_max_items", 30)))
        limits = allocate_limits(max_items=max_items, task_type=task_type)
        semantic_items = self._apply_budget(filtered, max_items=limits["semantic"])
        working_items = working[: limits["working"]]
        episodic_items = episodic[: limits["episodic"]]
        semantic_payload = [item.to_dict() for item in semantic_items]

        recent_changes = self.index_manager.get_recent_state_changes(
            limit=max(1, int(getattr(self.config, "memory_orchestrator_recent_changes_limit", 10)))
        )

        active_constraints = [
            item.to_dict()
            for item in semantic_items
            if item.category in {"world_rule", "open_loop"}
        ]
        warnings = []
        if conflicts:
            warnings.append(
                {
                    "type": "memory_conflict",
                    "count": len(conflicts),
                    "sample": conflicts[:5],
                }
            )

        return {
            "working_memory": working_items,
            "episodic_memory": episodic_items,
            "semantic_memory": semantic_payload,
            # long_term_facts 保持对外 contract：仅包含可直接注入的长期语义事实。
            "long_term_facts": semantic_payload,
            "active_constraints": active_constraints,
            "recent_changes": list(recent_changes),
            "warnings": warnings,
            "stats": {
                "total": len(active_items),
                "working_total": len(working),
                "episodic_total": len(episodic),
                "semantic_total": len(filtered),
                "injected": len(semantic_payload),
                "layered_total_injected": len(working_items) + len(episodic_items) + len(semantic_payload),
                "filtered": max(0, len(active_items) - len(filtered)),
                "conflicts": len(conflicts),
            },
        }

    def _filter_relevant(self, items: List[MemoryItem], chapter: int, outline: str) -> List[MemoryItem]:
        if not items:
            return []
        if not outline:
            return sorted(items, key=lambda x: (x.source_chapter, x.updated_at), reverse=True)

        keep: List[MemoryItem] = []
        source_window = max(1, int(getattr(self.config, "memory_orchestrator_source_window", 20)))
        for item in items:
            if item.subject and item.subject in outline:
                keep.append(item)
                continue
            if item.field and item.field in outline:
                keep.append(item)
                continue
            if item.value and item.value[:20] in outline:
                keep.append(item)
                continue
            if item.source_chapter > 0 and chapter - item.source_chapter <= source_window:
                keep.append(item)

        return sorted(keep, key=lambda x: (self.PRIORITY.get(x.category, 99), -x.source_chapter))

    def _apply_budget(self, items: List[MemoryItem], max_items: int) -> List[MemoryItem]:
        if max_items <= 0:
            return []
        if len(items) <= max_items:
            return list(items)
        return list(items[:max_items])

    def _load_state(self) -> Dict[str, Any]:
        path = self.config.state_file
        if not path.exists():
            return {}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            import sys
            print(f"⚠️ state.json 读取失败: {exc}", file=sys.stderr)
            return {}

    def _load_recent_summaries(self, chapter: int, window: int) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        summary_dir = self.config.webnovel_dir / "summaries"
        if not summary_dir.exists():
            return result
        for ch in range(max(1, chapter - window), chapter):
            path = summary_dir / f"ch{ch:04d}.md"
            if not path.exists():
                continue
            text = path.read_text(encoding="utf-8")
            if text:
                result.append({"layer": "working", "source": "summary", "chapter": ch, "content": text[:800]})
        return result

    def _build_working_memory(self, chapter: int, outline: str) -> List[Dict[str, Any]]:
        state = self._load_state()
        result: List[Dict[str, Any]] = []
        if outline:
            result.append({"layer": "working", "source": "outline", "chapter": chapter, "content": outline})

        summary_window = max(1, int(getattr(self.config, "context_recent_summaries_window", 3)))
        result.extend(self._load_recent_summaries(chapter=chapter, window=summary_window))

        state_export = {
            "protagonist_state": state.get("protagonist_state", {}),
            "plot_threads": state.get("plot_threads", {}),
            "disambiguation_pending": state.get("disambiguation_pending", []),
        }
        result.append(
            {
                "layer": "working",
                "source": "state_export",
                "chapter": chapter,
                "content": state_export,
            }
        )
        return result

    def _build_episodic_memory(self, chapter: int) -> List[Dict[str, Any]]:
        _ = chapter
        changes_limit = max(1, int(getattr(self.config, "memory_orchestrator_recent_changes_limit", 10)))
        rel_limit = max(1, min(20, changes_limit))

        recent_changes = self.index_manager.get_recent_state_changes(limit=changes_limit)
        recent_relationships = self.index_manager.get_recent_relationships(limit=rel_limit)
        recent_appearances = self.index_manager.get_recent_appearances(limit=rel_limit)

        result: List[Dict[str, Any]] = []
        for row in recent_changes:
            result.append(
                {
                    "layer": "episodic",
                    "source": "state_change",
                    "chapter": int(row.get("chapter") or 0),
                    "entity_id": row.get("entity_id", ""),
                    "field": row.get("field", ""),
                    "content": row,
                }
            )
        for row in recent_relationships:
            result.append(
                {
                    "layer": "episodic",
                    "source": "relationship",
                    "chapter": int(row.get("chapter") or 0),
                    "entity_id": row.get("from_entity", ""),
                    "field": row.get("to_entity", ""),
                    "content": row,
                }
            )
        for row in recent_appearances:
            result.append(
                {
                    "layer": "episodic",
                    "source": "appearance",
                    "chapter": int(row.get("chapter") or 0),
                    "entity_id": row.get("entity_id", ""),
                    "field": "appearance",
                    "content": row,
                }
            )

        result.sort(key=lambda x: int(x.get("chapter") or 0), reverse=True)
        return result
