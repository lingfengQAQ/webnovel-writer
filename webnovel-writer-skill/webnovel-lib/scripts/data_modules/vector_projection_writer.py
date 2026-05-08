#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
import hashlib
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

        chunk_counts: Dict[str, int] = {}

        for event in commit_payload.get("accepted_events") or []:
            if not isinstance(event, dict):
                continue
            text = self._event_to_text(event)
            if text:
                evt_chapter = int(event.get("chapter") or chapter)
                event_key = event.get("event_id") or f"{event.get('event_type')}:{event.get('subject')}:{text}"
                chunk_id = self._unique_chunk_id(chunk_counts, "event", evt_chapter, event_key)
                chunks.append({
                    "chunk_id": chunk_id,
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
                delta_key = delta.get("delta_id") or delta.get("entity_id") or text
                chunk_id = self._unique_chunk_id(chunk_counts, "entity_delta", d_chapter, delta_key)
                chunks.append({
                    "chunk_id": chunk_id,
                    "chapter": d_chapter,
                    "scene_index": 0,
                    "content": text,
                    "chunk_type": "entity_delta",
                    "parent_chunk_id": f"ch{d_chapter:04d}_summary",
                    "source_file": f"commit:chapter_{d_chapter:03d}",
                })

        return chunks

    def _unique_chunk_id(
        self,
        counts: Dict[str, int],
        kind: str,
        chapter: int,
        key: Any,
    ) -> str:
        base_id = self._chunk_id(kind, chapter, key)
        occurrence = counts.get(base_id, 0) + 1
        counts[base_id] = occurrence
        return base_id if occurrence == 1 else f"{base_id}_{occurrence}"

    def _chunk_id(self, kind: str, chapter: int, key: Any) -> str:
        raw = f"{kind}:{chapter}:{key}"
        digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]
        return f"ch{chapter:04d}_{kind}_{digest}"

    def _event_to_text(self, event: dict) -> str:
        chapter = int(event.get("chapter") or 0)
        subject = str(event.get("subject") or "").strip()
        event_type = str(event.get("event_type") or "").strip()
        payload = event.get("payload") or {}

        if event_type == "power_breakthrough":
            new_val = str(
                payload.get("new")
                or payload.get("to")
                or payload.get("new_value")
                or payload.get("new_state")
                or ""
            ).strip()
            return f"第{chapter}章：{subject}突破至{new_val}" if new_val else ""
        elif event_type == "character_state_changed":
            field = str(
                payload.get("field") or payload.get("field_path") or ""
            ).strip()
            new_val = str(
                payload.get("new")
                or payload.get("to")
                or payload.get("new_value")
                or payload.get("new_state")
                or ""
            ).strip()
            description = str(payload.get("description") or "").strip()
            if field and new_val:
                return f"第{chapter}章：{subject}的{field}变为{new_val}"
            if new_val:
                return f"第{chapter}章：{subject}变化为{new_val}"
            if description:
                return f"第{chapter}章：{subject}：{description}"
            return ""
        elif event_type == "relationship_changed":
            to_entity = str(payload.get("to_entity") or payload.get("to") or "").strip()
            rel_type = str(payload.get("relationship_type") or payload.get("type") or "").strip()
            return f"第{chapter}章：{subject}与{to_entity}关系变为{rel_type}" if to_entity else ""
        elif event_type in ("world_rule_revealed", "world_rule_broken"):
            desc = str(
                payload.get("description")
                or payload.get("rule")
                or payload.get("rule_content")
                or ""
            ).strip()
            action = "揭示" if "revealed" in event_type else "打破"
            return f"第{chapter}章：{action}世界规则——{desc}" if desc else ""
        elif event_type == "open_loop_created":
            description = str(
                payload.get("description")
                or payload.get("unanswered_question")
                or payload.get("content")
                or ""
            ).strip()
            return f"第{chapter}章：{subject}埋下悬念——{description}" if description else ""
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
