#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Index Manager - 索引管理模块

管理 index.db (SQLite) 的读写操作：
- 章节元数据索引
- 实体出场记录
- 场景索引
- 快速查询接口
"""

import sqlite3
import json
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from contextlib import contextmanager

from .config import get_config


@dataclass
class ChapterMeta:
    """章节元数据"""
    chapter: int
    title: str
    location: str
    word_count: int
    characters: List[str]
    summary: str = ""


@dataclass
class SceneMeta:
    """场景元数据"""
    chapter: int
    scene_index: int
    start_line: int
    end_line: int
    location: str
    summary: str
    characters: List[str]


class IndexManager:
    """索引管理器"""

    def __init__(self, config=None):
        self.config = config or get_config()
        self._init_db()

    def _init_db(self):
        """初始化数据库表"""
        self.config.ensure_dirs()

        with self._get_conn() as conn:
            cursor = conn.cursor()

            # 章节表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS chapters (
                    chapter INTEGER PRIMARY KEY,
                    title TEXT,
                    location TEXT,
                    word_count INTEGER,
                    characters TEXT,
                    summary TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # 场景表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS scenes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chapter INTEGER,
                    scene_index INTEGER,
                    start_line INTEGER,
                    end_line INTEGER,
                    location TEXT,
                    summary TEXT,
                    characters TEXT,
                    UNIQUE(chapter, scene_index)
                )
            """)

            # 实体出场表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS appearances (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity_id TEXT,
                    chapter INTEGER,
                    mentions TEXT,
                    confidence REAL,
                    UNIQUE(entity_id, chapter)
                )
            """)

            # 创建索引
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_scenes_chapter ON scenes(chapter)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_appearances_entity ON appearances(entity_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_appearances_chapter ON appearances(chapter)")

            conn.commit()

    @contextmanager
    def _get_conn(self):
        """获取数据库连接"""
        conn = sqlite3.connect(str(self.config.index_db))
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    # ==================== 章节操作 ====================

    def add_chapter(self, meta: ChapterMeta):
        """添加/更新章节元数据"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO chapters
                (chapter, title, location, word_count, characters, summary)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                meta.chapter,
                meta.title,
                meta.location,
                meta.word_count,
                json.dumps(meta.characters, ensure_ascii=False),
                meta.summary
            ))
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
            cursor.execute("""
                SELECT * FROM chapters
                ORDER BY chapter DESC
                LIMIT ?
            """, (limit,))
            return [self._row_to_dict(row, parse_json=["characters"]) for row in cursor.fetchall()]

    # ==================== 场景操作 ====================

    def add_scenes(self, chapter: int, scenes: List[SceneMeta]):
        """添加章节场景"""
        with self._get_conn() as conn:
            cursor = conn.cursor()

            # 先删除该章节旧场景
            cursor.execute("DELETE FROM scenes WHERE chapter = ?", (chapter,))

            # 插入新场景
            for scene in scenes:
                cursor.execute("""
                    INSERT INTO scenes
                    (chapter, scene_index, start_line, end_line, location, summary, characters)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    scene.chapter,
                    scene.scene_index,
                    scene.start_line,
                    scene.end_line,
                    scene.location,
                    scene.summary,
                    json.dumps(scene.characters, ensure_ascii=False)
                ))

            conn.commit()

    def get_scenes(self, chapter: int) -> List[Dict]:
        """获取章节场景"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM scenes
                WHERE chapter = ?
                ORDER BY scene_index
            """, (chapter,))
            return [self._row_to_dict(row, parse_json=["characters"]) for row in cursor.fetchall()]

    def search_scenes_by_location(self, location: str, limit: int = None) -> List[Dict]:
        """按地点搜索场景"""
        if limit is None:
            limit = self.config.query_scenes_by_location_limit
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM scenes
                WHERE location LIKE ?
                ORDER BY chapter DESC
                LIMIT ?
            """, (f"%{location}%", limit))
            return [self._row_to_dict(row, parse_json=["characters"]) for row in cursor.fetchall()]

    # ==================== 出场记录操作 ====================

    def record_appearance(
        self,
        entity_id: str,
        chapter: int,
        mentions: List[str],
        confidence: float = 1.0
    ):
        """记录实体出场"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO appearances
                (entity_id, chapter, mentions, confidence)
                VALUES (?, ?, ?, ?)
            """, (
                entity_id,
                chapter,
                json.dumps(mentions, ensure_ascii=False),
                confidence
            ))
            conn.commit()

    def get_entity_appearances(self, entity_id: str, limit: int = None) -> List[Dict]:
        """获取实体出场记录"""
        if limit is None:
            limit = self.config.query_entity_appearances_limit
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM appearances
                WHERE entity_id = ?
                ORDER BY chapter DESC
                LIMIT ?
            """, (entity_id, limit))
            return [self._row_to_dict(row, parse_json=["mentions"]) for row in cursor.fetchall()]

    def get_recent_appearances(self, limit: int = None) -> List[Dict]:
        """获取最近出场的实体"""
        if limit is None:
            limit = self.config.query_recent_appearances_limit
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT entity_id, MAX(chapter) as last_chapter, COUNT(*) as total
                FROM appearances
                GROUP BY entity_id
                ORDER BY last_chapter DESC
                LIMIT ?
            """, (limit,))
            return [dict(row) for row in cursor.fetchall()]

    def get_chapter_appearances(self, chapter: int) -> List[Dict]:
        """获取某章所有出场实体"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM appearances
                WHERE chapter = ?
                ORDER BY confidence DESC
            """, (chapter,))
            return [self._row_to_dict(row, parse_json=["mentions"]) for row in cursor.fetchall()]

    # ==================== 批量操作 ====================

    def process_chapter_data(
        self,
        chapter: int,
        title: str,
        location: str,
        word_count: int,
        entities: List[Dict],
        scenes: List[Dict]
    ) -> Dict[str, int]:
        """
        处理章节数据，批量写入索引

        返回写入统计
        """
        stats = {"chapters": 0, "scenes": 0, "appearances": 0}

        # 提取出场角色
        characters = [e.get("id") for e in entities if e.get("type") == "角色"]

        # 写入章节元数据
        self.add_chapter(ChapterMeta(
            chapter=chapter,
            title=title,
            location=location,
            word_count=word_count,
            characters=characters,
            summary=""  # 可后续由 Data Agent 生成
        ))
        stats["chapters"] = 1

        # 写入场景
        scene_metas = []
        for s in scenes:
            scene_metas.append(SceneMeta(
                chapter=chapter,
                scene_index=s.get("index", 0),
                start_line=s.get("start_line", 0),
                end_line=s.get("end_line", 0),
                location=s.get("location", ""),
                summary=s.get("summary", ""),
                characters=s.get("characters", [])
            ))
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
                    confidence=entity.get("confidence", 1.0)
                )
                stats["appearances"] += 1

        return stats

    # ==================== 辅助方法 ====================

    def _row_to_dict(self, row: sqlite3.Row, parse_json: List[str] = None) -> Dict:
        """将 Row 转换为字典"""
        d = dict(row)
        if parse_json:
            for key in parse_json:
                if key in d and d[key]:
                    try:
                        d[key] = json.loads(d[key])
                    except json.JSONDecodeError:
                        pass
        return d

    def get_stats(self) -> Dict[str, int]:
        """获取索引统计"""
        with self._get_conn() as conn:
            cursor = conn.cursor()

            cursor.execute("SELECT COUNT(*) FROM chapters")
            chapters = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM scenes")
            scenes = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(DISTINCT entity_id) FROM appearances")
            entities = cursor.fetchone()[0]

            cursor.execute("SELECT MAX(chapter) FROM chapters")
            max_chapter = cursor.fetchone()[0] or 0

            return {
                "chapters": chapters,
                "scenes": scenes,
                "entities": entities,
                "max_chapter": max_chapter
            }


# ==================== CLI 接口 ====================

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Index Manager CLI")
    parser.add_argument("--project-root", type=str, help="项目根目录")

    subparsers = parser.add_subparsers(dest="command")

    # 获取统计
    subparsers.add_parser("stats")

    # 查询章节
    chapter_parser = subparsers.add_parser("get-chapter")
    chapter_parser.add_argument("--chapter", type=int, required=True)

    # 查询最近出场
    recent_parser = subparsers.add_parser("recent-appearances")
    recent_parser.add_argument("--limit", type=int, default=None)

    # 查询实体出场
    entity_parser = subparsers.add_parser("entity-appearances")
    entity_parser.add_argument("--entity", required=True)
    entity_parser.add_argument("--limit", type=int, default=None)

    # 搜索场景
    search_parser = subparsers.add_parser("search-scenes")
    search_parser.add_argument("--location", required=True)
    search_parser.add_argument("--limit", type=int, default=None)

    # 处理章节数据 (写入)
    process_parser = subparsers.add_parser("process-chapter")
    process_parser.add_argument("--chapter", type=int, required=True)
    process_parser.add_argument("--title", required=True)
    process_parser.add_argument("--location", required=True)
    process_parser.add_argument("--word-count", type=int, required=True)
    process_parser.add_argument("--entities", required=True, help="JSON 格式的实体列表")
    process_parser.add_argument("--scenes", required=True, help="JSON 格式的场景列表")

    args = parser.parse_args()

    # 初始化
    config = None
    if args.project_root:
        from .config import DataModulesConfig
        config = DataModulesConfig.from_project_root(args.project_root)

    manager = IndexManager(config)

    if args.command == "stats":
        stats = manager.get_stats()
        print(json.dumps(stats, ensure_ascii=False, indent=2))

    elif args.command == "get-chapter":
        chapter = manager.get_chapter(args.chapter)
        if chapter:
            print(json.dumps(chapter, ensure_ascii=False, indent=2))
        else:
            print(f"未找到章节: {args.chapter}")

    elif args.command == "recent-appearances":
        appearances = manager.get_recent_appearances(args.limit)
        for a in appearances:
            print(f"{a['entity_id']}: 最后出场第 {a['last_chapter']} 章, 共 {a['total']} 次")

    elif args.command == "entity-appearances":
        appearances = manager.get_entity_appearances(args.entity, args.limit)
        print(f"{args.entity} 出场记录:")
        for a in appearances:
            print(f"  第 {a['chapter']} 章: {a['mentions']}")

    elif args.command == "search-scenes":
        scenes = manager.search_scenes_by_location(args.location, args.limit)
        for s in scenes:
            print(f"第 {s['chapter']} 章 场景 {s['scene_index']}: {s['location']}")
            print(f"  {s['summary'][:50]}...")

    elif args.command == "process-chapter":
        entities = json.loads(args.entities)
        scenes = json.loads(args.scenes)
        stats = manager.process_chapter_data(
            chapter=args.chapter,
            title=args.title,
            location=args.location,
            word_count=args.word_count,
            entities=entities,
            scenes=scenes
        )
        print(f"✓ 已处理第 {args.chapter} 章")
        print(f"  章节: {stats['chapters']}, 场景: {stats['scenes']}, 出场记录: {stats['appearances']}")


if __name__ == "__main__":
    main()
