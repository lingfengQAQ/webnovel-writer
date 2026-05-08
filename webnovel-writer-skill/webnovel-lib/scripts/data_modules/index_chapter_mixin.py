#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
IndexChapterMixin extracted from IndexManager.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional


class IndexChapterMixin:
    def add_chapter(self, meta: ChapterMeta):
        """添加/更新章节元数据"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT OR REPLACE INTO chapters
                (chapter, title, location, word_count, characters, summary)
                VALUES (?, ?, ?, ?, ?, ?)
            """,
                (
                    meta.chapter,
                    meta.title,
                    meta.location,
                    meta.word_count,
                    json.dumps(meta.characters, ensure_ascii=False),
                    meta.summary,
                ),
            )
            conn.commit()

    def get_chapter(self, chapter: int) -> Optional[Dict]:
        """获取章节元数据"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM chapters WHERE chapter = ?", (chapter,))
            row = cursor.fetchone()
            if row:
                return self._row_to_dict(row, parse_json=["characters"])
            return None

    def get_recent_chapters(self, limit: int = None) -> List[Dict]:
        """获取最近章节"""
        if limit is None:
            limit = self.config.query_recent_chapters_limit
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM chapters
                ORDER BY chapter DESC
                LIMIT ?
            """,
                (limit,),
            )
            return [
                self._row_to_dict(row, parse_json=["characters"])
                for row in cursor.fetchall()
            ]

    # ==================== 场景操作 ====================

    def add_scenes(self, chapter: int, scenes: List[SceneMeta]):
        """添加章节场景"""
        with self._get_conn() as conn:
            cursor = conn.cursor()

            # 先删除该章节旧场景
            cursor.execute("DELETE FROM scenes WHERE chapter = ?", (chapter,))

            # 插入新场景
            for scene in scenes:
                cursor.execute(
                    """
                    INSERT INTO scenes
                    (chapter, scene_index, start_line, end_line, location, summary, characters)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        scene.chapter,
                        scene.scene_index,
                        scene.start_line,
                        scene.end_line,
                        scene.location,
                        scene.summary,
                        json.dumps(scene.characters, ensure_ascii=False),
                    ),
                )

            conn.commit()

    def get_scenes(self, chapter: int) -> List[Dict]:
        """获取章节场景"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM scenes
                WHERE chapter = ?
                ORDER BY scene_index
            """,
                (chapter,),
            )
            return [
                self._row_to_dict(row, parse_json=["characters"])
                for row in cursor.fetchall()
            ]

    def search_scenes_by_location(self, location: str, limit: int = None) -> List[Dict]:
        """按地点搜索场景"""
        if limit is None:
            limit = self.config.query_scenes_by_location_limit
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM scenes
                WHERE location LIKE ?
                ORDER BY chapter DESC
                LIMIT ?
            """,
                (f"%{location}%", limit),
            )
            return [
                self._row_to_dict(row, parse_json=["characters"])
                for row in cursor.fetchall()
            ]

    # ==================== 出场记录操作 ====================

    def record_appearance(
        self,
        entity_id: str,
        chapter: int,
        mentions: List[str],
        confidence: float = 1.0,
        skip_if_exists: bool = False,
    ):
        """记录实体出场

        Args:
            entity_id: 实体ID
            chapter: 章节号
            mentions: 提及列表
            confidence: 置信度
            skip_if_exists: 如果为True，当记录已存在时跳过（避免覆盖已有mentions）
        """
        with self._get_conn() as conn:
            cursor = conn.cursor()

            if skip_if_exists:
                # 先检查是否已存在
                cursor.execute(
                    "SELECT 1 FROM appearances WHERE entity_id = ? AND chapter = ?",
                    (entity_id, chapter),
                )
                if cursor.fetchone():
                    return  # 已存在，跳过

            cursor.execute(
                """
                INSERT OR REPLACE INTO appearances
                (entity_id, chapter, mentions, confidence)
                VALUES (?, ?, ?, ?)
            """,
                (
                    entity_id,
                    chapter,
                    json.dumps(mentions, ensure_ascii=False),
                    confidence,
                ),
            )
            conn.commit()

    def get_entity_appearances(self, entity_id: str, limit: int = None) -> List[Dict]:
        """获取实体出场记录"""
        if limit is None:
            limit = self.config.query_entity_appearances_limit
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM appearances
                WHERE entity_id = ?
                ORDER BY chapter DESC
                LIMIT ?
            """,
                (entity_id, limit),
            )
            return [
                self._row_to_dict(row, parse_json=["mentions"])
                for row in cursor.fetchall()
            ]

    def get_recent_appearances(self, limit: int = None) -> List[Dict]:
        """获取最近出场的实体"""
        if limit is None:
            limit = self.config.query_recent_appearances_limit
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT entity_id, MAX(chapter) as last_chapter, COUNT(*) as total
                FROM appearances
                GROUP BY entity_id
                ORDER BY last_chapter DESC
                LIMIT ?
            """,
                (limit,),
            )
            return [dict(row) for row in cursor.fetchall()]

    def get_chapter_appearances(self, chapter: int) -> List[Dict]:
        """获取某章所有出场实体"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM appearances
                WHERE chapter = ?
                ORDER BY confidence DESC
            """,
                (chapter,),
            )
            return [
                self._row_to_dict(row, parse_json=["mentions"])
                for row in cursor.fetchall()
            ]

    # ==================== v5.1 实体操作 ====================

    def process_chapter_data(
        self,
        chapter: int,
        title: str,
        location: str,
        word_count: int,
        entities: List[Dict],
        scenes: List[Dict],
    ) -> Dict[str, int]:
        """
        处理章节数据，批量写入索引

        返回写入统计
        """
        from .index_manager import ChapterMeta, SceneMeta

        stats = {"chapters": 0, "scenes": 0, "appearances": 0}

        # 提取出场角色
        characters = [e.get("id") for e in entities if e.get("type") == "角色"]

        # 写入章节元数据
        self.add_chapter(
            ChapterMeta(
                chapter=chapter,
                title=title,
                location=location,
                word_count=word_count,
                characters=characters,
                summary="",  # 可后续由 Data Agent 生成
            )
        )
        stats["chapters"] = 1

        # 写入场景
        scene_metas = []
        for s in scenes:
            scene_metas.append(
                SceneMeta(
                    chapter=chapter,
                    scene_index=s.get("index", 0),
                    start_line=s.get("start_line", 0),
                    end_line=s.get("end_line", 0),
                    location=s.get("location", ""),
                    summary=s.get("summary", ""),
                    characters=s.get("characters", []),
                )
            )
        self.add_scenes(chapter, scene_metas)
        stats["scenes"] = len(scene_metas)

        # 写入出场记录
        for entity in entities:
            entity_id = entity.get("id")
            if entity_id and entity_id != "NEW":
                self.record_appearance(
                    entity_id=entity_id,
                    chapter=chapter,
                    mentions=entity.get("mentions", []),
                    confidence=entity.get("confidence", 1.0),
                )
                stats["appearances"] += 1

        return stats

    # ==================== 辅助方法 ====================

