#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Style Sampler - 风格样本管理模块

管理高质量章节片段作为风格参考：
- 风格样本存储
- 按场景类型分类
- 样本选择策略
"""

import json
import sqlite3
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from datetime import datetime
from enum import Enum
from contextlib import contextmanager

from .config import get_config


class SceneType(Enum):
    """场景类型"""
    BATTLE = "战斗"
    DIALOGUE = "对话"
    DESCRIPTION = "描写"
    TRANSITION = "过渡"
    EMOTION = "情感"
    TENSION = "紧张"
    COMEDY = "轻松"


@dataclass
class StyleSample:
    """风格样本"""
    id: str
    chapter: int
    scene_type: str
    content: str
    score: float
    tags: List[str]
    created_at: str = ""


class StyleSampler:
    """风格样本管理器"""

    def __init__(self, config=None):
        self.config = config or get_config()
        self._init_db()

    def _init_db(self):
        """初始化数据库"""
        self.config.ensure_dirs()
        with self._get_conn() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS samples (
                    id TEXT PRIMARY KEY,
                    chapter INTEGER,
                    scene_type TEXT,
                    content TEXT,
                    score REAL,
                    tags TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            cursor.execute("CREATE INDEX IF NOT EXISTS idx_samples_type ON samples(scene_type)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_samples_score ON samples(score DESC)")

            conn.commit()

    @contextmanager
    def _get_conn(self):
        """获取数据库连接（确保关闭，避免 Windows 下文件句柄泄漏导致无法清理临时目录）"""
        db_path = self.config.webnovel_dir / "style_samples.db"
        conn = sqlite3.connect(str(db_path))
        try:
            yield conn
        finally:
            conn.close()

    # ==================== 样本管理 ====================

    def add_sample(self, sample: StyleSample) -> bool:
        """添加风格样本"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute("""
                    INSERT INTO samples
                    (id, chapter, scene_type, content, score, tags, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    sample.id,
                    sample.chapter,
                    sample.scene_type,
                    sample.content,
                    sample.score,
                    json.dumps(sample.tags, ensure_ascii=False),
                    sample.created_at or datetime.now().isoformat()
                ))
                conn.commit()
                return True
            except sqlite3.IntegrityError:
                return False

    def get_samples_by_type(
        self,
        scene_type: str,
        limit: int = 5,
        min_score: float = 0.0
    ) -> List[StyleSample]:
        """按场景类型获取样本"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, chapter, scene_type, content, score, tags, created_at
                FROM samples
                WHERE scene_type = ? AND score >= ?
                ORDER BY score DESC
                LIMIT ?
            """, (scene_type, min_score, limit))

            return [self._row_to_sample(row) for row in cursor.fetchall()]

    def get_best_samples(self, limit: int = 10) -> List[StyleSample]:
        """获取最高分样本"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, chapter, scene_type, content, score, tags, created_at
                FROM samples
                ORDER BY score DESC
                LIMIT ?
            """, (limit,))

            return [self._row_to_sample(row) for row in cursor.fetchall()]

    def _row_to_sample(self, row) -> StyleSample:
        """将数据库行转换为样本对象"""
        return StyleSample(
            id=row[0],
            chapter=row[1],
            scene_type=row[2],
            content=row[3],
            score=row[4],
            tags=json.loads(row[5]) if row[5] else [],
            created_at=row[6]
        )

    # ==================== 样本提取 ====================

    def extract_candidates(
        self,
        chapter: int,
        content: str,
        review_score: float,
        scenes: List[Dict]
    ) -> List[StyleSample]:
        """
        从章节中提取风格样本候选

        只有高分章节 (review_score >= 80) 才提取样本
        """
        if review_score < 80:
            return []

        candidates = []

        for scene in scenes:
            scene_type = self._classify_scene_type(scene)
            scene_content = scene.get("content", "")

            # 跳过过短的场景
            if len(scene_content) < 200:
                continue

            # 创建样本
            sample = StyleSample(
                id=f"ch{chapter}_s{scene.get('index', 0)}",
                chapter=chapter,
                scene_type=scene_type,
                content=scene_content[:2000],  # 限制长度
                score=review_score / 100.0,
                tags=self._extract_tags(scene_content)
            )
            candidates.append(sample)

        return candidates

    def _classify_scene_type(self, scene: Dict) -> str:
        """分类场景类型"""
        summary = scene.get("summary", "").lower()
        content = scene.get("content", "").lower()

        # 简单关键词分类
        battle_keywords = ["战斗", "攻击", "出手", "拳", "剑", "杀", "打", "斗"]
        dialogue_keywords = ["说道", "问道", "笑道", "冷声", "对话"]
        emotion_keywords = ["心中", "感觉", "情", "泪", "痛", "喜"]
        tension_keywords = ["危险", "紧张", "恐惧", "压力"]

        text = summary + content

        if any(kw in text for kw in battle_keywords):
            return SceneType.BATTLE.value
        elif any(kw in text for kw in tension_keywords):
            return SceneType.TENSION.value
        elif any(kw in text for kw in dialogue_keywords):
            return SceneType.DIALOGUE.value
        elif any(kw in text for kw in emotion_keywords):
            return SceneType.EMOTION.value
        else:
            return SceneType.DESCRIPTION.value

    def _extract_tags(self, content: str) -> List[str]:
        """提取内容标签"""
        tags = []

        # 简单标签提取
        if "战斗" in content or "攻击" in content:
            tags.append("战斗")
        if "修炼" in content or "突破" in content:
            tags.append("修炼")
        if "对话" in content or "说道" in content:
            tags.append("对话")
        if "描写" in content or "景色" in content:
            tags.append("描写")

        return tags[:5]

    # ==================== 样本选择 ====================

    def select_samples_for_chapter(
        self,
        chapter_outline: str,
        target_types: List[str] = None,
        max_samples: int = 3
    ) -> List[StyleSample]:
        """
        为章节写作选择合适的风格样本

        基于大纲分析需要什么类型的样本
        """
        if target_types is None:
            # 根据大纲推断需要的场景类型
            target_types = self._infer_scene_types(chapter_outline)

        samples = []
        per_type = max(1, max_samples // len(target_types)) if target_types else max_samples

        for scene_type in target_types:
            type_samples = self.get_samples_by_type(scene_type, limit=per_type, min_score=0.8)
            samples.extend(type_samples)

        return samples[:max_samples]

    def _infer_scene_types(self, outline: str) -> List[str]:
        """从大纲推断需要的场景类型"""
        types = []

        if any(kw in outline for kw in ["战斗", "对决", "比试", "交手"]):
            types.append(SceneType.BATTLE.value)

        if any(kw in outline for kw in ["对话", "谈话", "商议", "讨论"]):
            types.append(SceneType.DIALOGUE.value)

        if any(kw in outline for kw in ["情感", "感情", "心理"]):
            types.append(SceneType.EMOTION.value)

        if not types:
            types = [SceneType.DESCRIPTION.value]

        return types

    # ==================== 统计 ====================

    def get_stats(self) -> Dict[str, Any]:
        """获取样本统计"""
        with self._get_conn() as conn:
            cursor = conn.cursor()

            cursor.execute("SELECT COUNT(*) FROM samples")
            total = cursor.fetchone()[0]

            cursor.execute("""
                SELECT scene_type, COUNT(*) as count
                FROM samples
                GROUP BY scene_type
            """)
            by_type = {row[0]: row[1] for row in cursor.fetchall()}

            cursor.execute("SELECT AVG(score) FROM samples")
            avg_score = cursor.fetchone()[0] or 0

            return {
                "total": total,
                "by_type": by_type,
                "avg_score": round(avg_score, 3)
            }


# ==================== CLI 接口 ====================

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Style Sampler CLI")
    parser.add_argument("--project-root", type=str, help="项目根目录")

    subparsers = parser.add_subparsers(dest="command")

    # 获取统计
    subparsers.add_parser("stats")

    # 列出样本
    list_parser = subparsers.add_parser("list")
    list_parser.add_argument("--type", help="按类型过滤")
    list_parser.add_argument("--limit", type=int, default=10)

    # 提取样本
    extract_parser = subparsers.add_parser("extract")
    extract_parser.add_argument("--chapter", type=int, required=True)
    extract_parser.add_argument("--score", type=float, required=True)
    extract_parser.add_argument("--scenes", required=True, help="JSON 格式的场景列表")

    # 选择样本
    select_parser = subparsers.add_parser("select")
    select_parser.add_argument("--outline", required=True, help="章节大纲")
    select_parser.add_argument("--max", type=int, default=3)

    args = parser.parse_args()

    # 初始化
    config = None
    if args.project_root:
        from .config import DataModulesConfig
        config = DataModulesConfig.from_project_root(args.project_root)

    sampler = StyleSampler(config)

    if args.command == "stats":
        stats = sampler.get_stats()
        print(json.dumps(stats, ensure_ascii=False, indent=2))

    elif args.command == "list":
        if args.type:
            samples = sampler.get_samples_by_type(args.type, args.limit)
        else:
            samples = sampler.get_best_samples(args.limit)

        for s in samples:
            print(f"\n[{s.scene_type}] 第 {s.chapter} 章 (score: {s.score:.2f})")
            print(f"  {s.content[:100]}...")

    elif args.command == "extract":
        scenes = json.loads(args.scenes)
        candidates = sampler.extract_candidates(
            chapter=args.chapter,
            content="",
            review_score=args.score,
            scenes=scenes
        )

        for c in candidates:
            if sampler.add_sample(c):
                print(f"✓ 添加样本: {c.id} ({c.scene_type})")
            else:
                print(f"✗ 样本已存在: {c.id}")

    elif args.command == "select":
        samples = sampler.select_samples_for_chapter(args.outline, max_samples=args.max)

        print(f"选择了 {len(samples)} 个风格样本:")
        for s in samples:
            print(f"\n[{s.scene_type}] 第 {s.chapter} 章")
            print(f"  {s.content[:200]}...")


if __name__ == "__main__":
    main()
