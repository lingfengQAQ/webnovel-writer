#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
IndexReadingMixin extracted from IndexManager.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional


class IndexReadingMixin:
    def save_chapter_reading_power(self, meta: ChapterReadingPowerMeta):
        """保存章节追读力元数据"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT OR REPLACE INTO chapter_reading_power
                (chapter, hook_type, hook_strength, coolpoint_patterns,
                 micropayoffs, hard_violations, soft_suggestions,
                 is_transition, override_count, debt_balance)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    meta.chapter,
                    meta.hook_type,
                    meta.hook_strength,
                    json.dumps(meta.coolpoint_patterns, ensure_ascii=False),
                    json.dumps(meta.micropayoffs, ensure_ascii=False),
                    json.dumps(meta.hard_violations, ensure_ascii=False),
                    json.dumps(meta.soft_suggestions, ensure_ascii=False),
                    1 if meta.is_transition else 0,
                    meta.override_count,
                    meta.debt_balance,
                ),
            )
            conn.commit()

    def get_chapter_reading_power(self, chapter: int) -> Optional[Dict]:
        """获取章节追读力元数据"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM chapter_reading_power WHERE chapter = ?", (chapter,)
            )
            row = cursor.fetchone()
            if row:
                return self._row_to_dict(
                    row,
                    parse_json=[
                        "coolpoint_patterns",
                        "micropayoffs",
                        "hard_violations",
                        "soft_suggestions",
                    ],
                )
            return None

    def get_recent_reading_power(self, limit: int = 10) -> List[Dict]:
        """获取最近章节的追读力元数据"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM chapter_reading_power
                ORDER BY chapter DESC
                LIMIT ?
            """,
                (limit,),
            )
            return [
                self._row_to_dict(
                    row,
                    parse_json=[
                        "coolpoint_patterns",
                        "micropayoffs",
                        "hard_violations",
                        "soft_suggestions",
                    ],
                )
                for row in cursor.fetchall()
            ]

    def get_pattern_usage_stats(self, last_n_chapters: int = 20) -> Dict[str, int]:
        """获取最近N章的爽点模式使用统计"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT coolpoint_patterns FROM chapter_reading_power
                ORDER BY chapter DESC
                LIMIT ?
            """,
                (last_n_chapters,),
            )

            stats = {}
            for row in cursor.fetchall():
                if row["coolpoint_patterns"]:
                    try:
                        patterns = json.loads(row["coolpoint_patterns"])
                        for p in patterns:
                            stats[p] = stats.get(p, 0) + 1
                    except json.JSONDecodeError as exc:
                        print(
                            f"[index_manager] failed to parse JSON in chapter_reading_power.coolpoint_patterns: {exc}",
                            file=sys.stderr,
                        )
            return stats

    def get_hook_type_stats(self, last_n_chapters: int = 20) -> Dict[str, int]:
        """获取最近N章的钩子类型使用统计"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT hook_type FROM chapter_reading_power
                WHERE hook_type IS NOT NULL AND hook_type != ''
                ORDER BY chapter DESC
                LIMIT ?
            """,
                (last_n_chapters,),
            )

            stats = {}
            for row in cursor.fetchall():
                hook = row["hook_type"]
                stats[hook] = stats.get(hook, 0) + 1
            return stats

    # ==================== v5.4 审查指标 ====================

    def save_review_metrics(self, metrics: ReviewMetrics) -> None:
        """保存审查指标记录"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO review_metrics
                (start_chapter, end_chapter, overall_score, dimension_scores,
                 severity_counts, critical_issues, report_file, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT(start_chapter, end_chapter)
                DO UPDATE SET
                    overall_score = excluded.overall_score,
                    dimension_scores = excluded.dimension_scores,
                    severity_counts = excluded.severity_counts,
                    critical_issues = excluded.critical_issues,
                    report_file = excluded.report_file,
                    notes = excluded.notes,
                    updated_at = CURRENT_TIMESTAMP
            """,
                (
                    metrics.start_chapter,
                    metrics.end_chapter,
                    metrics.overall_score,
                    json.dumps(metrics.dimension_scores, ensure_ascii=False),
                    json.dumps(metrics.severity_counts, ensure_ascii=False),
                    json.dumps(metrics.critical_issues, ensure_ascii=False),
                    metrics.report_file,
                    metrics.notes,
                ),
            )
            conn.commit()

    def get_recent_review_metrics(self, limit: int = 5) -> List[Dict]:
        """获取最近审查记录"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM review_metrics
                ORDER BY end_chapter DESC, start_chapter DESC
                LIMIT ?
            """,
                (limit,),
            )
            return [
                self._row_to_dict(
                    row,
                    parse_json=["dimension_scores", "severity_counts", "critical_issues"],
                )
                for row in cursor.fetchall()
            ]

    def get_review_trend_stats(self, last_n: int = 5) -> Dict[str, Any]:
        """获取审查趋势统计"""
        records = self.get_recent_review_metrics(last_n)
        if not records:
            return {
                "count": 0,
                "overall_avg": 0.0,
                "dimension_avg": {},
                "severity_totals": {},
                "recent_ranges": [],
            }

        overall_scores: List[float] = []
        dimension_totals: Dict[str, float] = {}
        dimension_counts: Dict[str, int] = {}
        severity_totals: Dict[str, int] = {}

        for record in records:
            score = record.get("overall_score")
            if score is not None:
                try:
                    overall_scores.append(float(score))
                except (TypeError, ValueError):
                    pass

            dimensions = record.get("dimension_scores") or {}
            if isinstance(dimensions, dict):
                for key, value in dimensions.items():
                    try:
                        val = float(value)
                    except (TypeError, ValueError):
                        continue
                    dimension_totals[key] = dimension_totals.get(key, 0.0) + val
                    dimension_counts[key] = dimension_counts.get(key, 0) + 1

            severities = record.get("severity_counts") or {}
            if isinstance(severities, dict):
                for key, value in severities.items():
                    try:
                        count = int(value)
                    except (TypeError, ValueError):
                        continue
                    severity_totals[key] = severity_totals.get(key, 0) + count

        overall_avg = round(sum(overall_scores) / len(overall_scores), 2) if overall_scores else 0.0
        dimension_avg = {
            key: round(dimension_totals[key] / dimension_counts[key], 2)
            for key in dimension_totals
            if dimension_counts.get(key, 0) > 0
        }
        recent_ranges = [
            {
                "start_chapter": record.get("start_chapter"),
                "end_chapter": record.get("end_chapter"),
                "overall_score": record.get("overall_score", 0),
            }
            for record in records
        ]

        return {
            "count": len(records),
            "overall_avg": overall_avg,
            "dimension_avg": dimension_avg,
            "severity_totals": severity_totals,
            "recent_ranges": recent_ranges,
        }

    # ==================== 写作清单评分（Phase F） ====================

    def save_writing_checklist_score(self, meta: WritingChecklistScoreMeta) -> None:
        """保存章节写作清单评分。"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO writing_checklist_scores (
                    chapter, template, total_items, required_items,
                    completed_items, completed_required,
                    total_weight, completed_weight, completion_rate, score,
                    score_breakdown, pending_items, source, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(chapter) DO UPDATE SET
                    template=excluded.template,
                    total_items=excluded.total_items,
                    required_items=excluded.required_items,
                    completed_items=excluded.completed_items,
                    completed_required=excluded.completed_required,
                    total_weight=excluded.total_weight,
                    completed_weight=excluded.completed_weight,
                    completion_rate=excluded.completion_rate,
                    score=excluded.score,
                    score_breakdown=excluded.score_breakdown,
                    pending_items=excluded.pending_items,
                    source=excluded.source,
                    notes=excluded.notes,
                    updated_at=CURRENT_TIMESTAMP
            """,
                (
                    meta.chapter,
                    meta.template,
                    meta.total_items,
                    meta.required_items,
                    meta.completed_items,
                    meta.completed_required,
                    meta.total_weight,
                    meta.completed_weight,
                    meta.completion_rate,
                    meta.score,
                    json.dumps(meta.score_breakdown, ensure_ascii=False),
                    json.dumps(meta.pending_items, ensure_ascii=False),
                    meta.source,
                    meta.notes,
                ),
            )
            conn.commit()

    def get_writing_checklist_score(self, chapter: int) -> Optional[Dict[str, Any]]:
        """获取指定章节的写作清单评分。"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM writing_checklist_scores WHERE chapter = ?",
                (chapter,),
            )
            row = cursor.fetchone()
            if not row:
                return None
            return self._row_to_dict(row, parse_json=["score_breakdown", "pending_items"])

    def get_recent_writing_checklist_scores(self, limit: int = 10) -> List[Dict[str, Any]]:
        """获取最近章节写作清单评分。"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM writing_checklist_scores
                ORDER BY chapter DESC
                LIMIT ?
            """,
                (limit,),
            )
            return [
                self._row_to_dict(row, parse_json=["score_breakdown", "pending_items"])
                for row in cursor.fetchall()
            ]

    def get_writing_checklist_score_trend(self, last_n: int = 10) -> Dict[str, Any]:
        """获取写作清单评分趋势统计。"""
        records = self.get_recent_writing_checklist_scores(limit=max(1, int(last_n)))
        if not records:
            return {
                "count": 0,
                "score_avg": 0.0,
                "completion_avg": 0.0,
                "required_completion_avg": 0.0,
                "recent": [],
            }

        scores: List[float] = []
        completion_rates: List[float] = []
        required_rates: List[float] = []
        for row in records:
            try:
                scores.append(float(row.get("score", 0.0)))
            except (TypeError, ValueError):
                pass
            try:
                completion_rates.append(float(row.get("completion_rate", 0.0)))
            except (TypeError, ValueError):
                pass

            required_items = int(row.get("required_items") or 0)
            completed_required = int(row.get("completed_required") or 0)
            if required_items > 0:
                required_rates.append(completed_required / required_items)
            else:
                required_rates.append(1.0)

        return {
            "count": len(records),
            "score_avg": round(sum(scores) / len(scores), 2) if scores else 0.0,
            "completion_avg": round(sum(completion_rates) / len(completion_rates), 4) if completion_rates else 0.0,
            "required_completion_avg": round(sum(required_rates) / len(required_rates), 4) if required_rates else 0.0,
            "recent": [
                {
                    "chapter": row.get("chapter"),
                    "score": row.get("score"),
                    "completion_rate": row.get("completion_rate"),
                }
                for row in records
            ],
        }

