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
        """查询实体在指定章节时的所有关系。"""
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
