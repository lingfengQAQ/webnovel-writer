#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
章节结果 -> 长期记忆项映射。
"""
from __future__ import annotations

import hashlib
from typing import Any, Dict, List

from ..config import DataModulesConfig, get_config
from .schema import MemoryItem
from .store import ScratchpadManager


class MemoryWriter:
    def __init__(self, config: DataModulesConfig | None = None):
        self.config = config or get_config()
        self.store = ScratchpadManager(self.config)

    def _item_id(self, category: str, subject: str, field: str, chapter: int) -> str:
        raw = f"{category}|{subject}|{field}|{chapter}"
        digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
        return f"mem-{category}-{digest}"

    def _upsert(self, item: MemoryItem, stats: Dict[str, Any]) -> None:
        result = self.store.upsert_item(item)
        stats["items_added"] += int(result.get("added", 0))
        stats["items_updated"] += int(result.get("updated", 0))
        stats["items_outdated"] += int(result.get("outdated", 0))

    @staticmethod
    def _coerce_loop_content(payload: Dict[str, Any], event: Dict[str, Any]) -> str:
        """从 open_loop 事件 payload 多个候选字段里取出有意义的悬念内容。

        优先级：content（旧 schema）→ unanswered_question（信息悬疑）
        → loop_type + description（结构化）→ description → subject 兜底。
        若兜底到 subject（通常是角色 ID），加上 loop_type 前缀避免变成纯 ID。
        """
        for key in ("content", "unanswered_question"):
            value = str(payload.get(key) or "").strip()
            if value:
                return value

        description = str(payload.get("description") or "").strip()
        loop_type = str(payload.get("loop_type") or "").strip()

        if description and loop_type:
            return f"{loop_type}：{description}"
        if description:
            return description
        if loop_type:
            return loop_type

        subject = str(event.get("subject") or "").strip()
        return subject

    def update_from_chapter_result(self, chapter: int, result: Dict[str, Any]) -> Dict[str, Any]:
        stats: Dict[str, Any] = {
            "chapter": int(chapter),
            "items_added": 0,
            "items_updated": 0,
            "items_outdated": 0,
            "warnings": [],
        }

        # Stage 2: 零成本结构化映射
        for change in result.get("state_changes", []) or []:
            entity_id = str(change.get("entity_id", "") or "").strip()
            field = str(
                change.get("field", "")
                or change.get("field_path", "")
                or ""
            ).strip()
            if not entity_id or not field:
                continue
            new_val = change.get("new")
            if new_val is None:
                new_val = change.get("new_value")
            if new_val is None:
                new_val = change.get("to")
            old_val = change.get("old")
            if old_val is None:
                old_val = change.get("old_value")
            if old_val is None:
                old_val = change.get("from")
            item = MemoryItem(
                id=self._item_id("character_state", entity_id, field, chapter),
                layer="semantic",
                category="character_state",
                subject=entity_id,
                field=field,
                value=str(new_val if new_val is not None else "" or ""),
                payload={"old_value": old_val},
                source_chapter=int(chapter),
                evidence=[f"state_change:{entity_id}:{field}:{chapter}"],
            )
            self._upsert(item, stats)

        for entity in result.get("entities_new", []) or []:
            entity_id = str(entity.get("suggested_id") or entity.get("id") or "").strip()
            name = str(entity.get("name", "") or "").strip()
            if not entity_id:
                continue
            item = MemoryItem(
                id=self._item_id("character_state", entity_id, "first_seen", chapter),
                layer="semantic",
                category="character_state",
                subject=entity_id,
                field="first_seen",
                value=name,
                payload={
                    "tier": entity.get("tier"),
                    "type": entity.get("type") or entity.get("entity_type"),
                },
                source_chapter=int(chapter),
                evidence=[f"entity_new:{entity_id}:{chapter}"],
            )
            self._upsert(item, stats)

        for rel in result.get("relationships_new", []) or []:
            from_entity = str(rel.get("from") or rel.get("from_entity") or "").strip()
            to_entity = str(rel.get("to") or rel.get("to_entity") or "").strip()
            rel_type = str(rel.get("type", "") or "").strip()
            if not from_entity or not to_entity:
                continue
            item = MemoryItem(
                id=self._item_id("relationship", from_entity, to_entity, chapter),
                layer="semantic",
                category="relationship",
                subject=from_entity,
                field=to_entity,
                value=rel_type,
                payload={"description": rel.get("description", ""), "to_entity": to_entity},
                source_chapter=int(chapter),
                evidence=[f"relationship:{from_entity}:{to_entity}:{chapter}"],
            )
            self._upsert(item, stats)

        chapter_meta = result.get("chapter_meta") or {}
        hook = chapter_meta.get("hook")
        if isinstance(hook, dict):
            hook_content = str(hook.get("content", "") or "").strip()
            if hook_content:
                item = MemoryItem(
                    id=self._item_id("story_fact", "chapter_hook", str(chapter), chapter),
                    layer="semantic",
                    category="story_fact",
                    subject="chapter_hook",
                    field=str(chapter),
                    value=hook_content,
                    payload={"hook_type": hook.get("type"), "strength": hook.get("strength")},
                    source_chapter=int(chapter),
                    evidence=[f"chapter_meta:hook:{chapter}"],
                )
                self._upsert(item, stats)
        elif isinstance(hook, str) and hook.strip():
            item = MemoryItem(
                id=self._item_id("story_fact", "chapter_hook", str(chapter), chapter),
                layer="semantic",
                category="story_fact",
                subject="chapter_hook",
                field=str(chapter),
                value=hook.strip(),
                payload={},
                source_chapter=int(chapter),
                evidence=[f"chapter_meta:hook:{chapter}"],
            )
            self._upsert(item, stats)

        # Stage 4: Data Agent 深度提取扩展
        memory_facts = result.get("memory_facts") or {}
        if isinstance(memory_facts, dict):
            self._apply_memory_facts(chapter, memory_facts, stats)

        return stats

    def _apply_memory_facts(self, chapter: int, memory_facts: Dict[str, Any], stats: Dict[str, Any]) -> None:
        timeline_events = memory_facts.get("timeline_events") or []
        for row in timeline_events:
            if not isinstance(row, dict):
                continue
            event = str(row.get("event", "") or "").strip()
            if not event:
                continue
            source_chapter = int(row.get("chapter") or chapter)
            item = MemoryItem(
                id=self._item_id("timeline", event, str(source_chapter), chapter),
                layer="semantic",
                category="timeline",
                subject=event[:64],
                field="event",
                value=event,
                payload={"time_hint": row.get("time_hint"), "event_type": row.get("event_type")},
                source_chapter=source_chapter,
                evidence=[f"memory_facts:timeline:{chapter}"],
            )
            self._upsert(item, stats)

        world_rules = memory_facts.get("world_rules") or []
        for row in world_rules:
            if not isinstance(row, dict):
                continue
            rule = str(row.get("rule", "") or "").strip()
            if not rule:
                continue
            subject = (
                str(row.get("domain", "") or "").strip()
                or str(row.get("scope", "") or "").strip()
                or "global"
            )
            field = str(row.get("field", "") or "").strip() or rule[:32]
            item = MemoryItem(
                id=self._item_id("world_rule", subject, field, chapter),
                layer="semantic",
                category="world_rule",
                subject=subject,
                field=field,
                value=rule,
                payload={"scope": row.get("scope"), "rule_text": rule},
                source_chapter=int(chapter),
                evidence=[f"memory_facts:world_rule:{chapter}"],
            )
            self._upsert(item, stats)

        open_loops = memory_facts.get("open_loops") or []
        for row in open_loops:
            if not isinstance(row, dict):
                continue
            content = str(row.get("content", "") or "").strip()
            if not content:
                continue
            item = MemoryItem(
                id=self._item_id("open_loop", content, "status", chapter),
                layer="semantic",
                category="open_loop",
                subject=content,
                field="status",
                value=content,
                payload={
                    "urgency": row.get("urgency"),
                    "planted_chapter": row.get("planted_chapter"),
                    "expected_payoff": row.get("expected_payoff"),
                    "status": row.get("status"),
                },
                source_chapter=int(chapter),
                evidence=[f"memory_facts:open_loop:{chapter}"],
            )
            self._upsert(item, stats)

        reader_promises = memory_facts.get("reader_promises") or []
        for row in reader_promises:
            if not isinstance(row, dict):
                continue
            content = str(row.get("content", "") or "").strip()
            if not content:
                continue
            item = MemoryItem(
                id=self._item_id("reader_promise", content, "promise", chapter),
                layer="semantic",
                category="reader_promise",
                subject=content,
                field="promise",
                value=content,
                payload={"promise_type": row.get("type"), "target": row.get("target")},
                source_chapter=int(chapter),
                evidence=[f"memory_facts:reader_promise:{chapter}"],
            )
            self._upsert(item, stats)

    def apply_commit_projection(self, commit_payload: Dict[str, Any]) -> Dict[str, Any]:
        chapter = int((commit_payload.get("meta") or {}).get("chapter") or 0)
        entity_deltas = list(commit_payload.get("entity_deltas") or [])
        accepted_events = list(commit_payload.get("accepted_events") or [])

        memory_facts: Dict[str, Any] = {
            "timeline_events": [],
            "world_rules": [],
            "open_loops": [],
            "reader_promises": [],
        }
        for event in accepted_events:
            if not isinstance(event, dict):
                continue
            event_type = str(event.get("event_type") or "").strip()
            payload = event.get("payload") or {}
            if event_type in {"world_rule_revealed", "world_rule_broken"}:
                rule_text = str(
                    payload.get("rule_content")
                    or payload.get("proposed_value")
                    or payload.get("rule")
                    or payload.get("base_value")
                    or payload.get("description")
                    or ""
                ).strip()
                if rule_text:
                    memory_facts["world_rules"].append(
                        {
                            "rule": rule_text,
                            "scope": payload.get("scope") or "global",
                            "domain": (
                                payload.get("domain")
                                or payload.get("rule_category")
                                or event.get("subject")
                                or "global"
                            ),
                            "field": payload.get("field") or event_type,
                        }
                    )
            elif event_type == "open_loop_created":
                content = self._coerce_loop_content(payload, event)
                if content:
                    memory_facts["open_loops"].append(
                        {
                            "content": content,
                            "status": payload.get("status") or "active",
                            "urgency": payload.get("urgency") or 0,
                            "planted_chapter": (
                                payload.get("planted_chapter") or event.get("chapter") or chapter
                            ),
                            "expected_payoff": (
                                payload.get("expected_payoff")
                                or payload.get("loop_deadline")
                            ),
                        }
                    )
            elif event_type in {"promise_created", "promise_paid_off"}:
                content = str(
                    payload.get("content")
                    or payload.get("description")
                    or event.get("subject")
                    or ""
                ).strip()
                if content:
                    memory_facts["reader_promises"].append(
                        {
                            "content": content,
                            "type": payload.get("type") or event_type,
                            "target": payload.get("target") or event.get("subject") or "",
                        }
                    )

        result = {
            "entities_new": [
                {
                    "suggested_id": row.get("entity_id") or row.get("id"),
                    "name": row.get("canonical_name")
                    or (row.get("payload") or {}).get("name")
                    or row.get("name")
                    or row.get("entity_id")
                    or row.get("id"),
                    "type": row.get("type") or row.get("entity_type") or "角色",
                    "tier": row.get("tier") or "装饰",
                }
                for row in entity_deltas
                if isinstance(row, dict)
                and str(row.get("entity_id") or row.get("id") or "").strip()
                and not (row.get("from_entity") or row.get("from"))
            ],
            "state_changes": list(commit_payload.get("state_deltas") or []),
            "relationships_new": [
                {
                    "from": row.get("from_entity") or row.get("from"),
                    "to": row.get("to_entity") or row.get("to"),
                    "type": row.get("relation_type") or row.get("relationship_type") or row.get("type"),
                    "description": row.get("description") or "",
                }
                for row in entity_deltas
                if isinstance(row, dict)
                and str(row.get("from_entity") or row.get("from") or "").strip()
                and str(row.get("to_entity") or row.get("to") or "").strip()
            ],
            "memory_facts": memory_facts,
        }
        return self.update_from_chapter_result(chapter, result)

