#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
IndexEntityMixin extracted from IndexManager.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional


logger = logging.getLogger(__name__)


class IndexEntityMixin:
    def upsert_entity(self, entity: EntityMeta, update_metadata: bool = False) -> bool:
        """
        插入或更新实体 (智能合并)

        - 新实体: 直接插入
        - 已存在: 更新 current_json, last_appearance, updated_at
        - update_metadata=True: 同时更新 canonical_name/tier/desc/is_protagonist/is_archived

        返回是否为新实体
        """
        with self._get_conn() as conn:
            cursor = conn.cursor()

            # 检查是否存在
            cursor.execute(
                "SELECT id, current_json FROM entities WHERE id = ?", (entity.id,)
            )
            existing = cursor.fetchone()

            if existing:
                # 已存在: 智能合并 current_json
                old_current = {}
                if existing["current_json"]:
                    try:
                        old_current = json.loads(existing["current_json"])
                    except json.JSONDecodeError as exc:
                        logger.warning(
                            "failed to parse JSON in entities.current_json: %s",
                            exc,
                        )

                # 合并 current (新值覆盖旧值)
                merged_current = {**old_current, **entity.current}

                if update_metadata:
                    # 完整更新（包括元数据）
                    cursor.execute(
                        """
                        UPDATE entities SET
                            canonical_name = ?,
                            tier = ?,
                            desc = ?,
                            current_json = ?,
                            last_appearance = ?,
                            is_protagonist = ?,
                            is_archived = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    """,
                        (
                            entity.canonical_name,
                            entity.tier,
                            entity.desc,
                            json.dumps(merged_current, ensure_ascii=False),
                            entity.last_appearance,
                            1 if entity.is_protagonist else 0,
                            1 if entity.is_archived else 0,
                            entity.id,
                        ),
                    )
                else:
                    # 只更新 current 和 last_appearance
                    cursor.execute(
                        """
                        UPDATE entities SET
                            current_json = ?,
                            last_appearance = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    """,
                        (
                            json.dumps(merged_current, ensure_ascii=False),
                            entity.last_appearance,
                            entity.id,
                        ),
                    )
                conn.commit()
                return False
            else:
                # 新实体: 插入
                cursor.execute(
                    """
                    INSERT INTO entities
                    (id, type, canonical_name, tier, desc, current_json,
                     first_appearance, last_appearance, is_protagonist, is_archived)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        entity.id,
                        entity.type,
                        entity.canonical_name,
                        entity.tier,
                        entity.desc,
                        json.dumps(entity.current, ensure_ascii=False),
                        entity.first_appearance,
                        entity.last_appearance,
                        1 if entity.is_protagonist else 0,
                        1 if entity.is_archived else 0,
                    ),
                )
                conn.commit()
                return True

    def get_entity(self, entity_id: str) -> Optional[Dict]:
        """获取单个实体"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM entities WHERE id = ?", (entity_id,))
            row = cursor.fetchone()
            if row:
                return self._row_to_dict(row, parse_json=["current_json"])
            return None

    def get_entities_by_type(
        self, entity_type: str, include_archived: bool = False
    ) -> List[Dict]:
        """按类型获取实体"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            if include_archived:
                cursor.execute(
                    """
                    SELECT * FROM entities WHERE type = ?
                    ORDER BY last_appearance DESC
                """,
                    (entity_type,),
                )
            else:
                cursor.execute(
                    """
                    SELECT * FROM entities WHERE type = ? AND is_archived = 0
                    ORDER BY last_appearance DESC
                """,
                    (entity_type,),
                )
            return [
                self._row_to_dict(row, parse_json=["current_json"])
                for row in cursor.fetchall()
            ]

    def get_entities_by_tier(self, tier: str) -> List[Dict]:
        """按重要度获取实体 (核心/重要/次要/装饰)"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM entities WHERE tier = ? AND is_archived = 0
                ORDER BY last_appearance DESC
            """,
                (tier,),
            )
            return [
                self._row_to_dict(row, parse_json=["current_json"])
                for row in cursor.fetchall()
            ]

    def get_core_entities(self) -> List[Dict]:
        """获取所有核心实体 (用于 Context Agent 全量加载)"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM entities
                WHERE (tier IN ('核心', '重要') OR is_protagonist = 1) AND is_archived = 0
                ORDER BY is_protagonist DESC, tier, last_appearance DESC
            """)
            return [
                self._row_to_dict(row, parse_json=["current_json"])
                for row in cursor.fetchall()
            ]

    def get_protagonist(self) -> Optional[Dict]:
        """获取主角实体"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM entities WHERE is_protagonist = 1 LIMIT 1")
            row = cursor.fetchone()
            if row:
                return self._row_to_dict(row, parse_json=["current_json"])
            return None

    def update_entity_current(self, entity_id: str, updates: Dict) -> bool:
        """
        增量更新实体的 current 字段 (不覆盖其他字段)

        例如: update_entity_current("xiaoyan", {"realm": "斗师"})
        """
        with self._get_conn() as conn:
            cursor = conn.cursor()

            cursor.execute(
                "SELECT current_json FROM entities WHERE id = ?", (entity_id,)
            )
            row = cursor.fetchone()
            if not row:
                return False

            current = {}
            if row["current_json"]:
                try:
                    current = json.loads(row["current_json"])
                except json.JSONDecodeError as exc:
                    logger.warning(
                        "failed to parse JSON in update_entity_current current_json: %s",
                        exc,
                    )

            current.update(updates)

            cursor.execute(
                """
                UPDATE entities SET
                    current_json = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """,
                (json.dumps(current, ensure_ascii=False), entity_id),
            )
            conn.commit()
            return True

    def archive_entity(self, entity_id: str) -> bool:
        """归档实体 (不删除，只是标记)"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE entities SET is_archived = 1, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """,
                (entity_id,),
            )
            conn.commit()
            return cursor.rowcount > 0

    # ==================== v5.1 别名操作 ====================

    def register_alias(self, alias: str, entity_id: str, entity_type: str) -> bool:
        """
        注册别名 (支持一对多)

        同一别名可映射多个实体 (如 "天云宗" → 地点 + 势力)
        """
        with self._get_conn() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute(
                    """
                    INSERT OR IGNORE INTO aliases (alias, entity_id, entity_type)
                    VALUES (?, ?, ?)
                """,
                    (alias, entity_id, entity_type),
                )
                conn.commit()
                return cursor.rowcount > 0
            except sqlite3.IntegrityError:
                return False

    def get_entities_by_alias(self, alias: str) -> List[Dict]:
        """
        根据别名查找实体 (一对多)

        返回所有匹配的实体 (可能有多个不同类型)
        """
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT e.*, a.entity_type as alias_type
                FROM entities e
                JOIN aliases a ON e.id = a.entity_id
                WHERE a.alias = ?
            """,
                (alias,),
            )
            return [
                self._row_to_dict(row, parse_json=["current_json"])
                for row in cursor.fetchall()
            ]

    def get_entity_aliases(self, entity_id: str) -> List[str]:
        """获取实体的所有别名"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT alias FROM aliases WHERE entity_id = ?", (entity_id,)
            )
            return [row["alias"] for row in cursor.fetchall()]

    def remove_alias(self, alias: str, entity_id: str) -> bool:
        """移除别名"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM aliases WHERE alias = ? AND entity_id = ?",
                (alias, entity_id),
            )
            conn.commit()
            return cursor.rowcount > 0

    # ==================== v5.1 状态变化操作 ====================

    def record_state_change(self, change: StateChangeMeta) -> int:
        """
        记录状态变化

        返回记录 ID
        """
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO state_changes
                (entity_id, field, old_value, new_value, reason, chapter)
                VALUES (?, ?, ?, ?, ?, ?)
            """,
                (
                    change.entity_id,
                    change.field,
                    change.old_value,
                    change.new_value,
                    change.reason,
                    change.chapter,
                ),
            )
            conn.commit()
            return cursor.lastrowid

    def get_entity_state_changes(self, entity_id: str, limit: int = 20) -> List[Dict]:
        """获取实体的状态变化历史"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM state_changes
                WHERE entity_id = ?
                ORDER BY chapter DESC, id DESC
                LIMIT ?
            """,
                (entity_id, limit),
            )
            return [dict(row) for row in cursor.fetchall()]

    def get_recent_state_changes(self, limit: int = 50) -> List[Dict]:
        """获取最近的状态变化"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM state_changes
                ORDER BY chapter DESC, id DESC
                LIMIT ?
            """,
                (limit,),
            )
            return [dict(row) for row in cursor.fetchall()]

    def get_chapter_state_changes(self, chapter: int) -> List[Dict]:
        """获取某章的所有状态变化"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM state_changes
                WHERE chapter = ?
                ORDER BY id
            """,
                (chapter,),
            )
            return [dict(row) for row in cursor.fetchall()]

    # ==================== v5.1 关系操作 ====================

    def upsert_relationship(self, rel: RelationshipMeta) -> bool:
        """
        插入或更新关系

        相同 (from, to, type) 会更新 description 和 chapter
        返回是否为新关系
        """
        with self._get_conn() as conn:
            cursor = conn.cursor()

            # 检查是否存在
            cursor.execute(
                """
                SELECT id FROM relationships
                WHERE from_entity = ? AND to_entity = ? AND type = ?
            """,
                (rel.from_entity, rel.to_entity, rel.type),
            )
            existing = cursor.fetchone()

            if existing:
                cursor.execute(
                    """
                    UPDATE relationships SET
                        description = ?,
                        chapter = ?
                    WHERE id = ?
                """,
                    (rel.description, rel.chapter, existing["id"]),
                )
                conn.commit()
                return False
            else:
                cursor.execute(
                    """
                    INSERT INTO relationships
                    (from_entity, to_entity, type, description, chapter)
                    VALUES (?, ?, ?, ?, ?)
                """,
                    (
                        rel.from_entity,
                        rel.to_entity,
                        rel.type,
                        rel.description,
                        rel.chapter,
                    ),
                )
                conn.commit()
                return True

    def get_entity_relationships(
        self, entity_id: str, direction: str = "both"
    ) -> List[Dict]:
        """
        获取实体的关系

        direction: "from" | "to" | "both"
        """
        with self._get_conn() as conn:
            cursor = conn.cursor()

            if direction == "from":
                cursor.execute(
                    """
                    SELECT * FROM relationships WHERE from_entity = ?
                    ORDER BY chapter DESC
                """,
                    (entity_id,),
                )
            elif direction == "to":
                cursor.execute(
                    """
                    SELECT * FROM relationships WHERE to_entity = ?
                    ORDER BY chapter DESC
                """,
                    (entity_id,),
                )
            else:  # both
                cursor.execute(
                    """
                    SELECT * FROM relationships
                    WHERE from_entity = ? OR to_entity = ?
                    ORDER BY chapter DESC
                """,
                    (entity_id, entity_id),
                )

            return [dict(row) for row in cursor.fetchall()]

    def get_relationship_between(self, entity1: str, entity2: str) -> List[Dict]:
        """获取两个实体之间的所有关系"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM relationships
                WHERE (from_entity = ? AND to_entity = ?)
                   OR (from_entity = ? AND to_entity = ?)
                ORDER BY chapter DESC
            """,
                (entity1, entity2, entity2, entity1),
            )
            return [dict(row) for row in cursor.fetchall()]

    def get_recent_relationships(self, limit: int = 30) -> List[Dict]:
        """获取最近建立的关系"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM relationships
                ORDER BY chapter DESC, id DESC
                LIMIT ?
            """,
                (limit,),
            )
            return [dict(row) for row in cursor.fetchall()]

    # ==================== v5.3 Override Contract 操作 ====================


    def update_entity_field(self, entity_id: str, field: str, value: Any) -> bool:
        """Compatibility helper to update a single entity field in current_json."""
        return self.update_entity_current(entity_id, {field: value})
