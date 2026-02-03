#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Index Manager - 索引管理模块 (v5.4)

管理 index.db (SQLite) 的读写操作：
- 章节元数据索引
- 实体出场记录
- 场景索引
- 实体存储 (从 state.json 迁移)
- 别名索引 (一对多)
- 状态变化记录
- 关系存储
- 快速查询接口
- 追读力债务管理 (v5.3 引入，v5.4 沿用)

v5.4 变更:
- 新增 invalid_facts 表：追踪无效事实 (pending/confirmed)
- 新增 tool_call_stats 表：记录工具调用成功率与错误信息
- 新增 review_metrics 表：记录审查指标与趋势数据

v5.3 变更:
- 新增 override_contracts 表：记录违背软建议时的Override Contract
- 新增 chase_debt 表：追读力债务追踪
- 新增 debt_events 表：债务事件日志（产生/偿还/利息）
- 新增 chapter_reading_power 表：章节追读力元数据

v5.1 变更:
- 新增 entities 表替代 state.json 中的 entities_v3
- 新增 aliases 表替代 state.json 中的 alias_index (支持一对多)
- 新增 state_changes 表替代 state.json 中的 state_changes
- 新增 relationships 表替代 state.json 中的 structured_relationships
"""

import sqlite3
import json
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from contextlib import contextmanager
from datetime import datetime

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


@dataclass
class EntityMeta:
    """实体元数据 (v5.1 引入)"""

    id: str
    type: str  # 角色/地点/物品/势力/招式
    canonical_name: str
    tier: str = "装饰"  # 核心/重要/次要/装饰
    desc: str = ""
    current: Dict = field(default_factory=dict)  # 当前状态 (realm/location/items等)
    first_appearance: int = 0
    last_appearance: int = 0
    is_protagonist: bool = False
    is_archived: bool = False


@dataclass
class StateChangeMeta:
    """状态变化记录 (v5.1 引入)"""

    entity_id: str
    field: str
    old_value: str
    new_value: str
    reason: str
    chapter: int


@dataclass
class RelationshipMeta:
    """关系记录 (v5.1 引入)"""

    from_entity: str
    to_entity: str
    type: str
    description: str
    chapter: int


@dataclass
class OverrideContractMeta:
    """Override Contract (v5.3 引入)"""

    chapter: int
    constraint_type: str  # SOFT_HOOK_STRENGTH / SOFT_MICROPAYOFF / etc.
    constraint_id: str  # 具体约束标识
    rationale_type: str  # TRANSITIONAL_SETUP / LOGIC_INTEGRITY / etc.
    rationale_text: str  # 具体理由说明
    payback_plan: str  # 偿还计划描述
    due_chapter: int  # 偿还截止章节
    status: str = "pending"  # pending / fulfilled / overdue / cancelled


@dataclass
class ChaseDebtMeta:
    """追读力债务 (v5.3 引入)"""

    id: int = 0
    debt_type: str = ""  # hook_strength / micropayoff / coolpoint / etc.
    original_amount: float = 1.0  # 初始债务量
    current_amount: float = 1.0  # 当前债务量（含利息）
    interest_rate: float = 0.1  # 利息率（每章）
    source_chapter: int = 0  # 产生债务的章节
    due_chapter: int = 0  # 截止章节
    override_contract_id: int = 0  # 关联的Override Contract
    status: str = "active"  # active / paid / overdue / written_off


@dataclass
class DebtEventMeta:
    """债务事件日志 (v5.3 引入)"""

    debt_id: int
    event_type: (
        str  # created / interest_accrued / partial_payment / full_payment / overdue
    )
    amount: float
    chapter: int
    note: str = ""


@dataclass
class ChapterReadingPowerMeta:
    """章节追读力元数据 (v5.3 引入)"""

    chapter: int
    hook_type: str = ""  # 章末钩子类型
    hook_strength: str = "medium"  # strong / medium / weak
    coolpoint_patterns: List[str] = field(default_factory=list)  # 使用的爽点模式
    micropayoffs: List[str] = field(default_factory=list)  # 微兑现列表
    hard_violations: List[str] = field(default_factory=list)  # 硬约束违规
    soft_suggestions: List[str] = field(default_factory=list)  # 软建议
    is_transition: bool = False  # 是否为过渡章
    override_count: int = 0  # Override Contract数量
    debt_balance: float = 0.0  # 当前债务余额


@dataclass
class ReviewMetrics:
    """审查指标记录 (v5.4 引入)"""

    start_chapter: int
    end_chapter: int
    overall_score: float = 0.0
    dimension_scores: Dict[str, float] = field(default_factory=dict)
    severity_counts: Dict[str, int] = field(default_factory=dict)
    critical_issues: List[str] = field(default_factory=list)
    report_file: str = ""
    notes: str = ""


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
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_scenes_chapter ON scenes(chapter)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_appearances_entity ON appearances(entity_id)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_appearances_chapter ON appearances(chapter)"
            )

            # ==================== v5.1 引入表 ====================

            # 实体表 (替代 state.json 中的 entities_v3)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS entities (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    canonical_name TEXT NOT NULL,
                    tier TEXT DEFAULT '装饰',
                    desc TEXT,
                    current_json TEXT,
                    first_appearance INTEGER DEFAULT 0,
                    last_appearance INTEGER DEFAULT 0,
                    is_protagonist INTEGER DEFAULT 0,
                    is_archived INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # 别名表 (替代 state.json 中的 alias_index，支持一对多)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS aliases (
                    alias TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    entity_type TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (alias, entity_id, entity_type)
                )
            """)

            # 状态变化表 (替代 state.json 中的 state_changes)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS state_changes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity_id TEXT NOT NULL,
                    field TEXT NOT NULL,
                    old_value TEXT,
                    new_value TEXT,
                    reason TEXT,
                    chapter INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # 关系表 (替代 state.json 中的 structured_relationships)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS relationships (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    from_entity TEXT NOT NULL,
                    to_entity TEXT NOT NULL,
                    type TEXT NOT NULL,
                    description TEXT,
                    chapter INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(from_entity, to_entity, type)
                )
            """)

            # v5.1 引入索引
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_entities_tier ON entities(tier)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_entities_protagonist ON entities(is_protagonist)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_aliases_entity ON aliases(entity_id)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_aliases_alias ON aliases(alias)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_state_changes_entity ON state_changes(entity_id)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_state_changes_chapter ON state_changes(chapter)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_entity)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_entity)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_relationships_chapter ON relationships(chapter)"
            )

            # ==================== v5.3 引入表：追读力债务管理 ====================

            # Override Contract 表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS override_contracts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chapter INTEGER NOT NULL,
                    constraint_type TEXT NOT NULL,
                    constraint_id TEXT NOT NULL,
                    rationale_type TEXT NOT NULL,
                    rationale_text TEXT,
                    payback_plan TEXT,
                    due_chapter INTEGER NOT NULL,
                    status TEXT DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    fulfilled_at TIMESTAMP,
                    UNIQUE(chapter, constraint_type, constraint_id)
                )
            """)

            # 追读力债务表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS chase_debt (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    debt_type TEXT NOT NULL,
                    original_amount REAL DEFAULT 1.0,
                    current_amount REAL DEFAULT 1.0,
                    interest_rate REAL DEFAULT 0.1,
                    source_chapter INTEGER NOT NULL,
                    due_chapter INTEGER NOT NULL,
                    override_contract_id INTEGER,
                    status TEXT DEFAULT 'active',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (override_contract_id) REFERENCES override_contracts(id)
                )
            """)

            # 债务事件日志表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS debt_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    debt_id INTEGER NOT NULL,
                    event_type TEXT NOT NULL,
                    amount REAL NOT NULL,
                    chapter INTEGER NOT NULL,
                    note TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (debt_id) REFERENCES chase_debt(id)
                )
            """)

            # 章节追读力元数据表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS chapter_reading_power (
                    chapter INTEGER PRIMARY KEY,
                    hook_type TEXT,
                    hook_strength TEXT DEFAULT 'medium',
                    coolpoint_patterns TEXT,
                    micropayoffs TEXT,
                    hard_violations TEXT,
                    soft_suggestions TEXT,
                    is_transition INTEGER DEFAULT 0,
                    override_count INTEGER DEFAULT 0,
                    debt_balance REAL DEFAULT 0.0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # v5.3 引入索引
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_override_contracts_chapter ON override_contracts(chapter)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_override_contracts_status ON override_contracts(status)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_override_contracts_due ON override_contracts(due_chapter)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_chase_debt_status ON chase_debt(status)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_chase_debt_source ON chase_debt(source_chapter)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_chase_debt_due ON chase_debt(due_chapter)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_debt_events_debt ON debt_events(debt_id)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_debt_events_chapter ON debt_events(chapter)"
            )

            # ==================== v5.4 新增表：无效事实与日志 ====================

            # 无效事实表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS invalid_facts (
                    id INTEGER PRIMARY KEY,
                    source_type TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    marked_by TEXT NOT NULL,
                    marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    confirmed_at TIMESTAMP,
                    chapter_discovered INTEGER
                )
            """)

            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_invalid_status ON invalid_facts(status)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_invalid_source ON invalid_facts(source_type, source_id)"
            )

            # 审查指标表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS review_metrics (
                    start_chapter INTEGER NOT NULL,
                    end_chapter INTEGER NOT NULL,
                    overall_score REAL DEFAULT 0,
                    dimension_scores TEXT,
                    severity_counts TEXT,
                    critical_issues TEXT,
                    report_file TEXT,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (start_chapter, end_chapter)
                )
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_review_metrics_end ON review_metrics(end_chapter)"
            )

            # RAG 查询日志
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS rag_query_log (
                    id INTEGER PRIMARY KEY,
                    query TEXT,
                    query_type TEXT,
                    results_count INTEGER,
                    hit_sources TEXT,
                    latency_ms INTEGER,
                    chapter INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_rag_query_type ON rag_query_log(query_type)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_rag_query_chapter ON rag_query_log(chapter)"
            )

            # 工具调用统计
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS tool_call_stats (
                    id INTEGER PRIMARY KEY,
                    tool_name TEXT,
                    success BOOLEAN,
                    retry_count INTEGER DEFAULT 0,
                    error_code TEXT,
                    error_message TEXT,
                    chapter INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_tool_stats_name ON tool_call_stats(tool_name)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_tool_stats_chapter ON tool_call_stats(chapter)"
            )

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
                    except json.JSONDecodeError:
                        pass

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
                except json.JSONDecodeError:
                    pass

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

    def create_override_contract(self, contract: OverrideContractMeta) -> int:
        """
        创建或更新 Override Contract

        使用 SQLite 的 INSERT ... ON CONFLICT ... DO UPDATE 实现原子 UPSERT：
        - 并发安全，无需显式锁
        - 保持 id 不变，避免 chase_debt.override_contract_id 悬挂
        - 完全冻结终态：已 fulfilled/cancelled 的合约所有字段都不会被修改

        兼容性：支持 SQLite 3.24+（ON CONFLICT 语法），不依赖 RETURNING（3.35+）

        返回合约 ID
        """
        with self._get_conn() as conn:
            cursor = conn.cursor()

            # 使用 ON CONFLICT 实现原子 UPSERT（SQLite 3.24+）
            # 终态完全冻结：fulfilled/cancelled 状态下所有字段都保持不变
            cursor.execute(
                """
                INSERT INTO override_contracts
                (chapter, constraint_type, constraint_id, rationale_type,
                 rationale_text, payback_plan, due_chapter, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(chapter, constraint_type, constraint_id) DO UPDATE SET
                    rationale_type = CASE
                        WHEN override_contracts.status IN ('fulfilled', 'cancelled')
                        THEN override_contracts.rationale_type
                        ELSE excluded.rationale_type
                    END,
                    rationale_text = CASE
                        WHEN override_contracts.status IN ('fulfilled', 'cancelled')
                        THEN override_contracts.rationale_text
                        ELSE excluded.rationale_text
                    END,
                    payback_plan = CASE
                        WHEN override_contracts.status IN ('fulfilled', 'cancelled')
                        THEN override_contracts.payback_plan
                        ELSE excluded.payback_plan
                    END,
                    due_chapter = CASE
                        WHEN override_contracts.status IN ('fulfilled', 'cancelled')
                        THEN override_contracts.due_chapter
                        ELSE excluded.due_chapter
                    END,
                    status = CASE
                        WHEN override_contracts.status IN ('fulfilled', 'cancelled')
                        THEN override_contracts.status
                        ELSE excluded.status
                    END
            """,
                (
                    contract.chapter,
                    contract.constraint_type,
                    contract.constraint_id,
                    contract.rationale_type,
                    contract.rationale_text,
                    contract.payback_plan,
                    contract.due_chapter,
                    contract.status,
                ),
            )

            # 不使用 RETURNING（需要 SQLite 3.35+），改用查询获取 id
            cursor.execute(
                """
                SELECT id FROM override_contracts
                WHERE chapter = ? AND constraint_type = ? AND constraint_id = ?
            """,
                (contract.chapter, contract.constraint_type, contract.constraint_id),
            )
            row = cursor.fetchone()
            if not row:
                # UPSERT 后查不到记录是异常情况，不应发生
                raise RuntimeError(
                    f"Override Contract UPSERT 后无法获取 id: "
                    f"chapter={contract.chapter}, type={contract.constraint_type}, "
                    f"id={contract.constraint_id}"
                )
            contract_id = row[0]

            conn.commit()
            return contract_id

    def get_pending_overrides(self, before_chapter: int = None) -> List[Dict]:
        """获取待偿还的Override Contracts"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            if before_chapter:
                cursor.execute(
                    """
                    SELECT * FROM override_contracts
                    WHERE status = 'pending' AND due_chapter <= ?
                    ORDER BY due_chapter ASC
                """,
                    (before_chapter,),
                )
            else:
                cursor.execute("""
                    SELECT * FROM override_contracts
                    WHERE status = 'pending'
                    ORDER BY due_chapter ASC
                """)
            return [dict(row) for row in cursor.fetchall()]

    def get_overdue_overrides(self, current_chapter: int) -> List[Dict]:
        """获取已逾期的Override Contracts"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM override_contracts
                WHERE status = 'pending' AND due_chapter < ?
                ORDER BY due_chapter ASC
            """,
                (current_chapter,),
            )
            return [dict(row) for row in cursor.fetchall()]

    def fulfill_override(self, contract_id: int) -> bool:
        """标记Override Contract为已偿还"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE override_contracts SET
                    status = 'fulfilled',
                    fulfilled_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """,
                (contract_id,),
            )
            conn.commit()
            return cursor.rowcount > 0

    def get_chapter_overrides(self, chapter: int) -> List[Dict]:
        """获取某章创建的Override Contracts"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM override_contracts WHERE chapter = ?
            """,
                (chapter,),
            )
            return [dict(row) for row in cursor.fetchall()]

    # ==================== v5.3 追读力债务操作 ====================

    def create_debt(self, debt: ChaseDebtMeta) -> int:
        """
        创建追读力债务

        返回债务 ID
        """
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO chase_debt
                (debt_type, original_amount, current_amount, interest_rate,
                 source_chapter, due_chapter, override_contract_id, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    debt.debt_type,
                    debt.original_amount,
                    debt.current_amount,
                    debt.interest_rate,
                    debt.source_chapter,
                    debt.due_chapter,
                    debt.override_contract_id if debt.override_contract_id else None,
                    debt.status,
                ),
            )
            conn.commit()
            debt_id = cursor.lastrowid

            # 记录创建事件
            self._record_debt_event(
                cursor,
                debt_id,
                "created",
                debt.original_amount,
                debt.source_chapter,
                f"创建债务: {debt.debt_type}",
            )
            conn.commit()
            return debt_id

    def get_active_debts(self) -> List[Dict]:
        """获取所有活跃债务"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM chase_debt
                WHERE status = 'active'
                ORDER BY due_chapter ASC
            """)
            return [dict(row) for row in cursor.fetchall()]

    def get_overdue_debts(self, current_chapter: int) -> List[Dict]:
        """获取已逾期的债务（包括 active 但已过期的，以及已标记为 overdue 的）"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM chase_debt
                WHERE (status = 'overdue')
                   OR (status = 'active' AND due_chapter < ?)
                ORDER BY due_chapter ASC
            """,
                (current_chapter,),
            )
            return [dict(row) for row in cursor.fetchall()]

    def get_total_debt_balance(self) -> float:
        """获取总债务余额（包括 active 和 overdue）"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT COALESCE(SUM(current_amount), 0) FROM chase_debt
                WHERE status IN ('active', 'overdue')
            """)
            return cursor.fetchone()[0]

    def accrue_interest(self, current_chapter: int) -> Dict[str, Any]:
        """
        计算利息（每章调用一次）

        - 对 active 和 overdue 债务都计息（逾期债务继续累积利息）
        - 使用 debt_events 表防止同一章重复计息
        - 检查逾期并更新状态

        返回: {debts_processed, total_interest, new_overdues, skipped_already_processed}
        """
        result = {
            "debts_processed": 0,
            "total_interest": 0.0,
            "new_overdues": 0,
            "skipped_already_processed": 0,
        }

        with self._get_conn() as conn:
            cursor = conn.cursor()

            # 获取所有未偿还债务（active + overdue 都继续计息）
            cursor.execute("""
                SELECT * FROM chase_debt WHERE status IN ('active', 'overdue')
            """)
            debts = cursor.fetchall()

            for debt in debts:
                debt_id = debt["id"]
                current_amount = debt["current_amount"]
                interest_rate = debt["interest_rate"]
                due_chapter = debt["due_chapter"]
                debt_status = debt["status"]

                # 检查本章是否已计息（防止重复调用）
                cursor.execute(
                    """
                    SELECT 1 FROM debt_events
                    WHERE debt_id = ? AND chapter = ? AND event_type = 'interest_accrued'
                """,
                    (debt_id, current_chapter),
                )
                if cursor.fetchone():
                    result["skipped_already_processed"] += 1
                    continue

                # 计算利息
                interest = current_amount * interest_rate
                new_amount = current_amount + interest

                # 更新债务
                cursor.execute(
                    """
                    UPDATE chase_debt SET
                        current_amount = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """,
                    (new_amount, debt_id),
                )

                # 记录利息事件
                self._record_debt_event(
                    cursor,
                    debt_id,
                    "interest_accrued",
                    interest,
                    current_chapter,
                    f"利息: {interest:.2f} (利率: {interest_rate * 100:.0f}%)",
                )

                result["debts_processed"] += 1
                result["total_interest"] += interest

                # 检查是否逾期（仅对 active 状态的债务）
                if debt_status == "active" and current_chapter > due_chapter:
                    cursor.execute(
                        """
                        UPDATE chase_debt SET status = 'overdue'
                        WHERE id = ? AND status = 'active'
                    """,
                        (debt_id,),
                    )
                    if cursor.rowcount > 0:
                        result["new_overdues"] += 1
                        self._record_debt_event(
                            cursor,
                            debt_id,
                            "overdue",
                            new_amount,
                            current_chapter,
                            f"债务逾期 (截止: 第{due_chapter}章)",
                        )

            conn.commit()

        return result

    def pay_debt(self, debt_id: int, amount: float, chapter: int) -> Dict[str, Any]:
        """
        偿还债务

        - 校验 amount > 0
        - 完全偿还时，使用原子 UPDATE 检查并标记关联 Override 为 fulfilled
          （并发安全：用 NOT EXISTS 子查询确保所有债务都已清零）

        返回: {remaining, fully_paid, override_fulfilled}
        """
        # 校验偿还金额
        if amount <= 0:
            return {
                "remaining": 0,
                "fully_paid": False,
                "error": "偿还金额必须大于0",
            }

        with self._get_conn() as conn:
            cursor = conn.cursor()

            cursor.execute(
                "SELECT current_amount, override_contract_id FROM chase_debt WHERE id = ?",
                (debt_id,),
            )
            row = cursor.fetchone()
            if not row:
                return {"remaining": 0, "fully_paid": False, "error": "债务不存在"}

            current = row["current_amount"]
            override_contract_id = row["override_contract_id"]
            remaining = max(0, current - amount)
            override_fulfilled = False

            if remaining == 0:
                # 完全偿还
                cursor.execute(
                    """
                    UPDATE chase_debt SET
                        current_amount = 0,
                        status = 'paid',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """,
                    (debt_id,),
                )
                self._record_debt_event(
                    cursor, debt_id, "full_payment", amount, chapter, "债务已完全偿还"
                )

                # 原子检查并标记 Override 为 fulfilled
                # 使用 NOT EXISTS 子查询确保并发安全：只有当确实没有未清债务时才更新
                if override_contract_id:
                    cursor.execute(
                        """
                        UPDATE override_contracts SET
                            status = 'fulfilled',
                            fulfilled_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                          AND status = 'pending'
                          AND NOT EXISTS (
                              SELECT 1 FROM chase_debt
                              WHERE override_contract_id = ?
                                AND status IN ('active', 'overdue')
                          )
                    """,
                        (override_contract_id, override_contract_id),
                    )
                    if cursor.rowcount > 0:
                        override_fulfilled = True
            else:
                # 部分偿还
                cursor.execute(
                    """
                    UPDATE chase_debt SET
                        current_amount = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """,
                    (remaining, debt_id),
                )
                self._record_debt_event(
                    cursor,
                    debt_id,
                    "partial_payment",
                    amount,
                    chapter,
                    f"部分偿还，剩余: {remaining:.2f}",
                )

            conn.commit()
            return {
                "remaining": remaining,
                "fully_paid": remaining == 0,
                "override_fulfilled": override_fulfilled,
            }

    def _record_debt_event(
        self,
        cursor,
        debt_id: int,
        event_type: str,
        amount: float,
        chapter: int,
        note: str = "",
    ):
        """记录债务事件（内部方法）"""
        cursor.execute(
            """
            INSERT INTO debt_events (debt_id, event_type, amount, chapter, note)
            VALUES (?, ?, ?, ?, ?)
        """,
            (debt_id, event_type, amount, chapter, note),
        )

    def get_debt_history(self, debt_id: int) -> List[Dict]:
        """获取债务的事件历史"""
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM debt_events
                WHERE debt_id = ?
                ORDER BY created_at ASC
            """,
                (debt_id,),
            )
            return [dict(row) for row in cursor.fetchall()]

    # ==================== v5.3 章节追读力元数据操作 ====================

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
                    except json.JSONDecodeError:
                        pass
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

    def get_debt_summary(self) -> Dict[str, Any]:
        """获取债务汇总信息"""
        with self._get_conn() as conn:
            cursor = conn.cursor()

            # 活跃债务
            cursor.execute("""
                SELECT COUNT(*) as count, COALESCE(SUM(current_amount), 0) as total
                FROM chase_debt WHERE status = 'active'
            """)
            active = cursor.fetchone()

            # 逾期债务
            cursor.execute("""
                SELECT COUNT(*) as count, COALESCE(SUM(current_amount), 0) as total
                FROM chase_debt WHERE status = 'overdue'
            """)
            overdue = cursor.fetchone()

            # 待偿还Override
            cursor.execute("""
                SELECT COUNT(*) FROM override_contracts WHERE status = 'pending'
            """)
            pending_overrides = cursor.fetchone()[0]

            return {
                "active_debts": active["count"],
                "active_total": active["total"],
                "overdue_debts": overdue["count"],
                "overdue_total": overdue["total"],
                "pending_overrides": pending_overrides,
                "total_balance": active["total"] + overdue["total"],
            }

    # ==================== 批量操作 ====================

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


# ==================== CLI 接口 ====================


def main():
    import argparse
    from .cli_output import print_success, print_error

    parser = argparse.ArgumentParser(description="Index Manager CLI (v5.4)")
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

    # ==================== v5.1 引入命令 ====================

    # 获取实体
    get_entity_parser = subparsers.add_parser("get-entity")
    get_entity_parser.add_argument("--id", required=True, help="实体 ID")

    # 获取核心实体
    subparsers.add_parser("get-core-entities")

    # 获取主角
    subparsers.add_parser("get-protagonist")

    # 按类型获取实体
    type_parser = subparsers.add_parser("get-entities-by-type")
    type_parser.add_argument(
        "--type", required=True, help="实体类型 (角色/地点/物品/势力/招式)"
    )
    type_parser.add_argument("--include-archived", action="store_true")

    # 按别名查找实体
    alias_parser = subparsers.add_parser("get-by-alias")
    alias_parser.add_argument("--alias", required=True, help="别名")

    # 获取实体别名
    aliases_parser = subparsers.add_parser("get-aliases")
    aliases_parser.add_argument("--entity", required=True, help="实体 ID")

    # 注册别名
    reg_alias_parser = subparsers.add_parser("register-alias")
    reg_alias_parser.add_argument("--alias", required=True)
    reg_alias_parser.add_argument("--entity", required=True)
    reg_alias_parser.add_argument("--type", required=True, help="实体类型")

    # 获取实体关系
    rel_parser = subparsers.add_parser("get-relationships")
    rel_parser.add_argument("--entity", required=True)
    rel_parser.add_argument(
        "--direction", choices=["from", "to", "both"], default="both"
    )

    # 获取状态变化
    changes_parser = subparsers.add_parser("get-state-changes")
    changes_parser.add_argument("--entity", required=True)
    changes_parser.add_argument("--limit", type=int, default=20)

    # 写入实体
    upsert_entity_parser = subparsers.add_parser("upsert-entity")
    upsert_entity_parser.add_argument(
        "--data", required=True, help="JSON 格式的实体数据"
    )

    # 写入关系
    upsert_rel_parser = subparsers.add_parser("upsert-relationship")
    upsert_rel_parser.add_argument("--data", required=True, help="JSON 格式的关系数据")

    # 写入状态变化
    state_change_parser = subparsers.add_parser("record-state-change")
    state_change_parser.add_argument(
        "--data", required=True, help="JSON 格式的状态变化数据"
    )

    # ==================== v5.4 新增命令 ====================
    invalid_parser = subparsers.add_parser("mark-invalid")
    invalid_parser.add_argument("--source-type", required=True)
    invalid_parser.add_argument("--source-id", required=True)
    invalid_parser.add_argument("--reason", required=True)
    invalid_parser.add_argument("--marked-by", default="user")
    invalid_parser.add_argument("--chapter", type=int, default=None)

    resolve_parser = subparsers.add_parser("resolve-invalid")
    resolve_parser.add_argument("--id", type=int, required=True)
    resolve_parser.add_argument("--action", choices=["confirm", "dismiss"], required=True)

    list_invalid_parser = subparsers.add_parser("list-invalid")
    list_invalid_parser.add_argument("--status", choices=["pending", "confirmed"], default=None)

    review_save_parser = subparsers.add_parser("save-review-metrics")
    review_save_parser.add_argument("--data", required=True, help="JSON 格式的审查指标数据")

    review_recent_parser = subparsers.add_parser("get-recent-review-metrics")
    review_recent_parser.add_argument("--limit", type=int, default=5)

    review_trend_parser = subparsers.add_parser("get-review-trend-stats")
    review_trend_parser.add_argument("--last-n", type=int, default=5)

    # ==================== v5.3 引入命令 ====================

    # 获取债务汇总
    subparsers.add_parser("get-debt-summary")

    # 获取最近章节追读力元数据
    reading_power_parser = subparsers.add_parser("get-recent-reading-power")
    reading_power_parser.add_argument("--limit", type=int, default=10)

    # 获取章节追读力元数据
    chapter_rp_parser = subparsers.add_parser("get-chapter-reading-power")
    chapter_rp_parser.add_argument("--chapter", type=int, required=True)

    # 获取爽点模式使用统计
    pattern_stats_parser = subparsers.add_parser("get-pattern-usage-stats")
    pattern_stats_parser.add_argument("--last-n", type=int, default=20)

    # 获取钩子类型使用统计
    hook_stats_parser = subparsers.add_parser("get-hook-type-stats")
    hook_stats_parser.add_argument("--last-n", type=int, default=20)

    # 获取待偿还Override
    pending_override_parser = subparsers.add_parser("get-pending-overrides")
    pending_override_parser.add_argument("--before-chapter", type=int, default=None)

    # 获取逾期Override
    overdue_override_parser = subparsers.add_parser("get-overdue-overrides")
    overdue_override_parser.add_argument("--current-chapter", type=int, required=True)

    # 获取活跃债务
    subparsers.add_parser("get-active-debts")

    # 获取逾期债务
    overdue_debt_parser = subparsers.add_parser("get-overdue-debts")
    overdue_debt_parser.add_argument("--current-chapter", type=int, required=True)

    # 计算利息
    accrue_parser = subparsers.add_parser("accrue-interest")
    accrue_parser.add_argument("--current-chapter", type=int, required=True)

    # 偿还债务
    pay_debt_parser = subparsers.add_parser("pay-debt")
    pay_debt_parser.add_argument("--debt-id", type=int, required=True)
    pay_debt_parser.add_argument("--amount", type=float, required=True)
    pay_debt_parser.add_argument("--chapter", type=int, required=True)

    # 创建Override Contract
    create_override_parser = subparsers.add_parser("create-override-contract")
    create_override_parser.add_argument(
        "--data", required=True, help="JSON 格式的Override Contract数据"
    )

    # 创建债务
    create_debt_parser = subparsers.add_parser("create-debt")
    create_debt_parser.add_argument("--data", required=True, help="JSON 格式的债务数据")

    # 标记Override已偿还
    fulfill_override_parser = subparsers.add_parser("fulfill-override")
    fulfill_override_parser.add_argument("--contract-id", type=int, required=True)

    # 保存章节追读力元数据
    save_rp_parser = subparsers.add_parser("save-chapter-reading-power")
    save_rp_parser.add_argument(
        "--data", required=True, help="JSON 格式的章节追读力元数据"
    )

    args = parser.parse_args()

    # 初始化
    config = None
    if args.project_root:
        from .config import DataModulesConfig

        config = DataModulesConfig.from_project_root(args.project_root)

    manager = IndexManager(config)
    tool_name = f"index_manager:{args.command or 'unknown'}"

    def emit_success(data=None, message: str = "ok", chapter: Optional[int] = None):
        print_success(data, message=message)
        try:
            manager.log_tool_call(tool_name, True, chapter=chapter)
        except Exception:
            pass

    def emit_error(code: str, message: str, suggestion: Optional[str] = None, chapter: Optional[int] = None):
        print_error(code, message, suggestion=suggestion)
        try:
            manager.log_tool_call(tool_name, False, error_code=code, error_message=message, chapter=chapter)
        except Exception:
            pass

    if args.command == "stats":
        emit_success(manager.get_stats(), message="stats")

    elif args.command == "get-chapter":
        chapter = manager.get_chapter(args.chapter)
        if chapter:
            emit_success(chapter, message="chapter")
        else:
            emit_error("NOT_FOUND", f"未找到章节: {args.chapter}")

    elif args.command == "recent-appearances":
        appearances = manager.get_recent_appearances(args.limit)
        emit_success(appearances, message="recent_appearances")

    elif args.command == "entity-appearances":
        appearances = manager.get_entity_appearances(args.entity, args.limit)
        emit_success({"entity": args.entity, "appearances": appearances}, message="entity_appearances")

    elif args.command == "search-scenes":
        scenes = manager.search_scenes_by_location(args.location, args.limit)
        emit_success(scenes, message="scenes")

    elif args.command == "process-chapter":
        entities = json.loads(args.entities)
        scenes = json.loads(args.scenes)
        stats = manager.process_chapter_data(
            chapter=args.chapter,
            title=args.title,
            location=args.location,
            word_count=args.word_count,
            entities=entities,
            scenes=scenes,
        )
        emit_success(stats, message="chapter_processed", chapter=args.chapter)

    # ==================== v5.1 引入命令处理 ====================

    elif args.command == "get-entity":
        entity = manager.get_entity(args.id)
        if entity:
            emit_success(entity, message="entity")
        else:
            emit_error("NOT_FOUND", f"未找到实体: {args.id}")

    elif args.command == "get-core-entities":
        entities = manager.get_core_entities()
        emit_success(entities, message="core_entities")

    elif args.command == "get-protagonist":
        protagonist = manager.get_protagonist()
        if protagonist:
            emit_success(protagonist, message="protagonist")
        else:
            emit_error("NOT_FOUND", "未设置主角")

    elif args.command == "get-entities-by-type":
        entities = manager.get_entities_by_type(args.type, args.include_archived)
        emit_success(entities, message="entities_by_type")

    elif args.command == "get-by-alias":
        entities = manager.get_entities_by_alias(args.alias)
        if entities:
            emit_success(entities, message="entities_by_alias")
        else:
            emit_error("NOT_FOUND", f"未找到别名: {args.alias}")

    elif args.command == "get-aliases":
        aliases = manager.get_entity_aliases(args.entity)
        if aliases:
            emit_success({"entity": args.entity, "aliases": aliases}, message="aliases")
        else:
            emit_error("NOT_FOUND", f"{args.entity} 没有别名")

    elif args.command == "register-alias":
        success = manager.register_alias(args.alias, args.entity, args.type)
        if success:
            emit_success(
                {"alias": args.alias, "entity": args.entity, "type": args.type},
                message="alias_registered",
            )
        else:
            emit_error("ALIAS_EXISTS", f"别名已存在或注册失败: {args.alias}")

    elif args.command == "get-relationships":
        rels = manager.get_entity_relationships(args.entity, args.direction)
        emit_success(rels, message="relationships")

    elif args.command == "get-state-changes":
        changes = manager.get_entity_state_changes(args.entity, args.limit)
        emit_success(changes, message="state_changes")

    elif args.command == "upsert-entity":
        data = json.loads(args.data)
        entity = EntityMeta(
            id=data["id"],
            type=data["type"],
            canonical_name=data["canonical_name"],
            tier=data.get("tier", "装饰"),
            desc=data.get("desc", ""),
            current=data.get("current", {}),
            first_appearance=data.get("first_appearance", 0),
            last_appearance=data.get("last_appearance", 0),
            is_protagonist=data.get("is_protagonist", False),
            is_archived=data.get("is_archived", False),
        )
        is_new = manager.upsert_entity(entity)
        emit_success({"id": entity.id, "created": is_new}, message="entity_upserted")

    elif args.command == "upsert-relationship":
        data = json.loads(args.data)
        rel = RelationshipMeta(
            from_entity=data["from_entity"],
            to_entity=data["to_entity"],
            type=data["type"],
            description=data.get("description", ""),
            chapter=data["chapter"],
        )
        is_new = manager.upsert_relationship(rel)
        emit_success(
            {"from": rel.from_entity, "to": rel.to_entity, "type": rel.type, "created": is_new},
            message="relationship_upserted",
        )

    elif args.command == "record-state-change":
        data = json.loads(args.data)
        change = StateChangeMeta(
            entity_id=data["entity_id"],
            field=data["field"],
            old_value=data.get("old_value", ""),
            new_value=data["new_value"],
            reason=data.get("reason", ""),
            chapter=data["chapter"],
        )
        record_id = manager.record_state_change(change)
        emit_success({"id": record_id, "entity": change.entity_id, "field": change.field}, message="state_change_recorded")

    # ==================== v5.4 无效事实命令处理 ====================

    elif args.command == "mark-invalid":
        invalid_id = manager.mark_invalid_fact(
            args.source_type,
            args.source_id,
            args.reason,
            marked_by=args.marked_by,
            chapter_discovered=args.chapter,
        )
        emit_success({"id": invalid_id}, message="invalid_marked")

    elif args.command == "resolve-invalid":
        ok = manager.resolve_invalid_fact(args.id, args.action)
        if ok:
            emit_success({"id": args.id, "action": args.action}, message="invalid_resolved")
        else:
            emit_error("INVALID_ACTION", f"无法处理 action: {args.action}")

    elif args.command == "list-invalid":
        rows = manager.list_invalid_facts(args.status)
        emit_success(rows, message="invalid_list")

    elif args.command == "save-review-metrics":
        data = json.loads(args.data)
        metrics = ReviewMetrics(
            start_chapter=data["start_chapter"],
            end_chapter=data["end_chapter"],
            overall_score=data.get("overall_score", 0.0),
            dimension_scores=data.get("dimension_scores", {}),
            severity_counts=data.get("severity_counts", {}),
            critical_issues=data.get("critical_issues", []),
            report_file=data.get("report_file", ""),
            notes=data.get("notes", ""),
        )
        manager.save_review_metrics(metrics)
        emit_success(
            {"start_chapter": metrics.start_chapter, "end_chapter": metrics.end_chapter},
            message="review_metrics_saved",
        )

    elif args.command == "get-recent-review-metrics":
        records = manager.get_recent_review_metrics(args.limit)
        emit_success(records, message="recent_review_metrics")

    elif args.command == "get-review-trend-stats":
        stats = manager.get_review_trend_stats(args.last_n)
        emit_success(stats, message="review_trend_stats")

    # ==================== v5.3 引入命令处理 ====================

    elif args.command == "get-debt-summary":
        summary = manager.get_debt_summary()
        emit_success(summary, message="debt_summary")

    elif args.command == "get-recent-reading-power":
        records = manager.get_recent_reading_power(args.limit)
        emit_success(records, message="recent_reading_power")

    elif args.command == "get-chapter-reading-power":
        record = manager.get_chapter_reading_power(args.chapter)
        if record:
            emit_success(record, message="chapter_reading_power")
        else:
            emit_error("NOT_FOUND", f"未找到第 {args.chapter} 章的追读力元数据")

    elif args.command == "get-pattern-usage-stats":
        stats = manager.get_pattern_usage_stats(args.last_n)
        emit_success(stats, message="pattern_usage_stats")

    elif args.command == "get-hook-type-stats":
        stats = manager.get_hook_type_stats(args.last_n)
        emit_success(stats, message="hook_type_stats")

    elif args.command == "get-pending-overrides":
        overrides = manager.get_pending_overrides(args.before_chapter)
        emit_success(overrides, message="pending_overrides")

    elif args.command == "get-overdue-overrides":
        overrides = manager.get_overdue_overrides(args.current_chapter)
        emit_success(overrides, message="overdue_overrides")

    elif args.command == "get-active-debts":
        debts = manager.get_active_debts()
        emit_success(debts, message="active_debts")

    elif args.command == "get-overdue-debts":
        debts = manager.get_overdue_debts(args.current_chapter)
        emit_success(debts, message="overdue_debts")

    elif args.command == "accrue-interest":
        result = manager.accrue_interest(args.current_chapter)
        emit_success(result, message="interest_accrued", chapter=args.current_chapter)

    elif args.command == "pay-debt":
        result = manager.pay_debt(args.debt_id, args.amount, args.chapter)
        if "error" in result:
            emit_error("PAY_DEBT_FAILED", result["error"], chapter=args.chapter)
        else:
            emit_success(result, message="debt_payment", chapter=args.chapter)

    elif args.command == "create-override-contract":
        data = json.loads(args.data)
        contract = OverrideContractMeta(
            chapter=data["chapter"],
            constraint_type=data["constraint_type"],
            constraint_id=data["constraint_id"],
            rationale_type=data["rationale_type"],
            rationale_text=data.get("rationale_text", ""),
            payback_plan=data.get("payback_plan", ""),
            due_chapter=data["due_chapter"],
            status=data.get("status", "pending"),
        )
        contract_id = manager.create_override_contract(contract)
        emit_success({"id": contract_id}, message="override_contract_created")

    elif args.command == "create-debt":
        data = json.loads(args.data)
        debt = ChaseDebtMeta(
            debt_type=data["debt_type"],
            original_amount=data.get("original_amount", 1.0),
            current_amount=data.get("current_amount", data.get("original_amount", 1.0)),
            interest_rate=data.get("interest_rate", 0.1),
            source_chapter=data["source_chapter"],
            due_chapter=data["due_chapter"],
            override_contract_id=data.get("override_contract_id", 0),
            status=data.get("status", "active"),
        )
        debt_id = manager.create_debt(debt)
        emit_success({"id": debt_id, "debt_type": debt.debt_type}, message="debt_created")

    elif args.command == "fulfill-override":
        success = manager.fulfill_override(args.contract_id)
        if success:
            emit_success({"id": args.contract_id}, message="override_fulfilled")
        else:
            emit_error("NOT_FOUND", f"未找到 Override Contract #{args.contract_id}")

    elif args.command == "save-chapter-reading-power":
        data = json.loads(args.data)
        meta = ChapterReadingPowerMeta(
            chapter=data["chapter"],
            hook_type=data.get("hook_type", ""),
            hook_strength=data.get("hook_strength", "medium"),
            coolpoint_patterns=data.get("coolpoint_patterns", []),
            micropayoffs=data.get("micropayoffs", []),
            hard_violations=data.get("hard_violations", []),
            soft_suggestions=data.get("soft_suggestions", []),
            is_transition=data.get("is_transition", False),
            override_count=data.get("override_count", 0),
            debt_balance=data.get("debt_balance", 0.0),
        )
        manager.save_chapter_reading_power(meta)
        emit_success({"chapter": meta.chapter}, message="reading_power_saved")

    else:
        emit_error("UNKNOWN_COMMAND", "未指定有效命令", suggestion="请查看 --help")


if __name__ == "__main__":
    main()
