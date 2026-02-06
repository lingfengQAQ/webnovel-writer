#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
IndexObservabilityMixin extracted from IndexManager.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional


logger = logging.getLogger(__name__)


class IndexObservabilityMixin:
    def _row_to_dict(self, row: sqlite3.Row, parse_json: List[str] = None) -> Dict:
        """将 Row 转换为字典"""
        d = dict(row)
        if parse_json:
            for key in parse_json:
                if key in d and d[key]:
                    try:
                        d[key] = json.loads(d[key])
                    except json.JSONDecodeError as exc:
                        logger.warning(
                            "failed to parse JSON field %s in _row_to_dict: %s",
                            key,
                            exc,
                        )
        return d

    # ==================== 无效事实管理 ====================

    def mark_invalid_fact(
        self,
        source_type: str,
        source_id: str,
        reason: str,
        marked_by: str = "user",
        chapter_discovered: Optional[int] = None,
    ) -> int:
        """标记无效事实（pending）"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO invalid_facts
                (source_type, source_id, reason, status, marked_by, chapter_discovered)
                VALUES (?, ?, ?, 'pending', ?, ?)
            """,
                (source_type, str(source_id), reason, marked_by, chapter_discovered),
            )
            conn.commit()
            return int(cursor.lastrowid)

    def resolve_invalid_fact(self, invalid_id: int, action: str) -> bool:
        """确认或撤销无效标记"""
        action = action.lower()
        with self._get_conn() as conn:
            cursor = conn.cursor()
            if action == "confirm":
                cursor.execute(
                    """
                    UPDATE invalid_facts
                    SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """,
                    (invalid_id,),
                )
            elif action == "dismiss":
                cursor.execute("DELETE FROM invalid_facts WHERE id = ?", (invalid_id,))
            else:
                return False
            conn.commit()
            return cursor.rowcount > 0

    def list_invalid_facts(self, status: Optional[str] = None) -> List[Dict]:
        """列出无效事实"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            if status:
                cursor.execute(
                    "SELECT * FROM invalid_facts WHERE status = ? ORDER BY id DESC",
                    (status,),
                )
            else:
                cursor.execute("SELECT * FROM invalid_facts ORDER BY id DESC")
            return [dict(r) for r in cursor.fetchall()]

    def get_invalid_ids(self, source_type: str, status: str = "confirmed") -> set[str]:
        """获取无效事实 ID 集合"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT source_id FROM invalid_facts WHERE source_type = ? AND status = ?",
                (source_type, status),
            )
            return {str(r[0]) for r in cursor.fetchall() if r and r[0] is not None}

    # ==================== 日志记录 ====================

    def log_rag_query(
        self,
        query: str,
        query_type: str,
        results_count: int,
        hit_sources: Optional[str] = None,
        latency_ms: Optional[int] = None,
        chapter: Optional[int] = None,
    ) -> None:
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO rag_query_log
                (query, query_type, results_count, hit_sources, latency_ms, chapter)
                VALUES (?, ?, ?, ?, ?, ?)
            """,
                (query, query_type, results_count, hit_sources, latency_ms, chapter),
            )
            conn.commit()

    def log_tool_call(
        self,
        tool_name: str,
        success: bool,
        retry_count: int = 0,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None,
        chapter: Optional[int] = None,
    ) -> None:
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO tool_call_stats
                (tool_name, success, retry_count, error_code, error_message, chapter)
                VALUES (?, ?, ?, ?, ?, ?)
            """,
                (tool_name, int(bool(success)), retry_count, error_code, error_message, chapter),
            )
            conn.commit()

    def get_stats(self) -> Dict[str, int]:
        """获取索引统计"""
        with self._get_conn() as conn:
            cursor = conn.cursor()

            cursor.execute("SELECT COUNT(*) FROM chapters")
            chapters = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM scenes")
            scenes = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(DISTINCT entity_id) FROM appearances")
            appearances = cursor.fetchone()[0]

            cursor.execute("SELECT MAX(chapter) FROM chapters")
            max_chapter = cursor.fetchone()[0] or 0

            # v5.1 引入统计
            cursor.execute("SELECT COUNT(*) FROM entities")
            entities = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM entities WHERE is_archived = 0")
            active_entities = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM aliases")
            aliases = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM state_changes")
            state_changes = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM relationships")
            relationships = cursor.fetchone()[0]

            # v5.3 引入统计
            cursor.execute("SELECT COUNT(*) FROM override_contracts")
            override_contracts = cursor.fetchone()[0]

            cursor.execute(
                "SELECT COUNT(*) FROM override_contracts WHERE status = 'pending'"
            )
            pending_overrides = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM chase_debt WHERE status = 'active'")
            active_debts = cursor.fetchone()[0]

            cursor.execute(
                "SELECT COALESCE(SUM(current_amount), 0) FROM chase_debt WHERE status IN ('active', 'overdue')"
            )
            total_debt = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM chapter_reading_power")
            reading_power_records = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM review_metrics")
            review_metrics = cursor.fetchone()[0]

            return {
                "chapters": chapters,
                "scenes": scenes,
                "appearances": appearances,
                "max_chapter": max_chapter,
                # v5.1 引入
                "entities": entities,
                "active_entities": active_entities,
                "aliases": aliases,
                "state_changes": state_changes,
                "relationships": relationships,
                # v5.3 引入
                "override_contracts": override_contracts,
                "pending_overrides": pending_overrides,
                "active_debts": active_debts,
                "total_debt": total_debt,
                "reading_power_records": reading_power_records,
                "review_metrics": review_metrics,
            }


