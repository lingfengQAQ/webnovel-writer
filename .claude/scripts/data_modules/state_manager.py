#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
State Manager - 状态管理模块 (v5.1)

管理 state.json 的读写操作：
- 实体状态管理
- 进度追踪
- 关系记录

v5.1 变更:
- 集成 SQLStateManager，同步写入 SQLite (index.db)
- state.json 保留精简数据，大数据自动迁移到 SQLite
"""

import json
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field, asdict
from datetime import datetime
import filelock

from .config import get_config

try:
    # 当 scripts 目录在 sys.path 中（常见：从 scripts/ 运行）
    from security_utils import atomic_write_json, read_json_safe
except ImportError:  # pragma: no cover
    # 当以 `python -m scripts.data_modules...` 从仓库根目录运行
    from scripts.security_utils import atomic_write_json, read_json_safe


@dataclass
class EntityState:
    """实体状态"""
    id: str
    name: str
    type: str  # 角色/地点/物品/势力
    tier: str = "装饰"  # 核心/支线/装饰
    aliases: List[str] = field(default_factory=list)
    attributes: Dict[str, Any] = field(default_factory=dict)
    first_appearance: int = 0
    last_appearance: int = 0


@dataclass
class Relationship:
    """实体关系"""
    from_entity: str
    to_entity: str
    type: str
    description: str
    chapter: int


@dataclass
class StateChange:
    """状态变化记录"""
    entity_id: str
    field: str
    old_value: Any
    new_value: Any
    reason: str
    chapter: int
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())


@dataclass
class _EntityPatch:
    """待写入的实体增量补丁（用于锁内合并）"""
    entity_type: str
    entity_id: str
    replace: bool = False
    base_entity: Optional[Dict[str, Any]] = None  # 新建实体时的完整快照（用于填充缺失字段）
    top_updates: Dict[str, Any] = field(default_factory=dict)
    current_updates: Dict[str, Any] = field(default_factory=dict)
    appearance_chapter: Optional[int] = None


class StateManager:
    """状态管理器 (v5.1 entities_v3 格式 + SQLite 同步)"""

    # v5.0 支持的实体类型
    ENTITY_TYPES = ["角色", "地点", "物品", "势力", "招式"]

    def __init__(self, config=None, enable_sqlite_sync: bool = True):
        """
        初始化状态管理器

        参数:
        - config: 配置对象
        - enable_sqlite_sync: 是否启用 SQLite 同步 (默认 True)
        """
        self.config = config or get_config()
        self._state: Dict[str, Any] = {}
        # 与 security_utils.atomic_write_json 保持一致：state.json.lock
        self._lock_path = self.config.state_file.with_suffix(self.config.state_file.suffix + ".lock")

        # v5.1: SQLite 同步
        self._enable_sqlite_sync = enable_sqlite_sync
        self._sql_state_manager = None
        if enable_sqlite_sync:
            try:
                from .sql_state_manager import SQLStateManager
                self._sql_state_manager = SQLStateManager(self.config)
            except ImportError:
                pass  # SQLStateManager 不可用时静默降级

        # 待写入的增量（锁内重读 + 合并 + 写入）
        self._pending_entity_patches: Dict[tuple[str, str], _EntityPatch] = {}
        self._pending_alias_entries: Dict[str, List[Dict[str, str]]] = {}
        self._pending_state_changes: List[Dict[str, Any]] = []
        self._pending_structured_relationships: List[Dict[str, Any]] = []
        self._pending_disambiguation_warnings: List[Dict[str, Any]] = []
        self._pending_disambiguation_pending: List[Dict[str, Any]] = []
        self._pending_progress_chapter: Optional[int] = None
        self._pending_progress_words_delta: int = 0

        # v5.1: 缓存待同步到 SQLite 的数据
        self._pending_sqlite_data: Dict[str, Any] = {
            "entities_appeared": [],
            "entities_new": [],
            "state_changes": [],
            "relationships_new": [],
            "chapter": None
        }

        self._load_state()

    def _now_progress_timestamp(self) -> str:
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def _ensure_state_schema(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """确保 state.json 具备运行所需的关键字段（尽量不破坏既有数据）。"""
        if not isinstance(state, dict):
            state = {}

        state.setdefault("project_info", {})
        state.setdefault("progress", {})
        state.setdefault("protagonist_state", {})

        # relationships: 旧版本可能是 list（实体关系），v5.0 运行态用 dict（人物关系/重要关系）
        relationships = state.get("relationships")
        if isinstance(relationships, list):
            state.setdefault("structured_relationships", [])
            if isinstance(state.get("structured_relationships"), list):
                state["structured_relationships"].extend(relationships)
            state["relationships"] = {}
        elif not isinstance(relationships, dict):
            state["relationships"] = {}

        state.setdefault("world_settings", {"power_system": [], "factions": [], "locations": []})
        state.setdefault("plot_threads", {"active_threads": [], "foreshadowing": []})
        state.setdefault("review_checkpoints", [])
        state.setdefault(
            "strand_tracker",
            {
                "last_quest_chapter": 0,
                "last_fire_chapter": 0,
                "last_constellation_chapter": 0,
                "current_dominant": "quest",
                "chapters_since_switch": 0,
                "history": [],
            },
        )

        entities_v3 = state.get("entities_v3")
        if not isinstance(entities_v3, dict):
            entities_v3 = {}
            state["entities_v3"] = entities_v3
        for t in self.ENTITY_TYPES:
            if not isinstance(entities_v3.get(t), dict):
                entities_v3[t] = {}

        if not isinstance(state.get("alias_index"), dict):
            state["alias_index"] = {}

        if not isinstance(state.get("state_changes"), list):
            state["state_changes"] = []

        if not isinstance(state.get("structured_relationships"), list):
            state["structured_relationships"] = []

        if not isinstance(state.get("disambiguation_warnings"), list):
            state["disambiguation_warnings"] = []

        if not isinstance(state.get("disambiguation_pending"), list):
            state["disambiguation_pending"] = []

        # progress 基础字段
        progress = state["progress"]
        if not isinstance(progress, dict):
            progress = {}
            state["progress"] = progress
        progress.setdefault("current_chapter", 0)
        progress.setdefault("total_words", 0)
        progress.setdefault("last_updated", self._now_progress_timestamp())

        return state

    def _load_state(self):
        """加载状态文件"""
        if self.config.state_file.exists():
            self._state = read_json_safe(self.config.state_file, default={})
            self._state = self._ensure_state_schema(self._state)
        else:
            self._state = self._ensure_state_schema({})

    def save_state(self):
        """
        保存状态文件（锁内重读 + 合并 + 原子写入）。

        解决多 Agent 并行下的“读-改-写覆盖”风险：
        - 获取锁
        - 重新读取磁盘最新 state.json
        - 仅合并本实例产生的增量（pending_*）
        - 原子化写入
        """
        # 无增量时不写入，避免无意义覆盖
        has_pending = any(
            [
                self._pending_entity_patches,
                self._pending_alias_entries,
                self._pending_state_changes,
                self._pending_structured_relationships,
                self._pending_disambiguation_warnings,
                self._pending_disambiguation_pending,
                self._pending_progress_chapter is not None,
                self._pending_progress_words_delta != 0,
            ]
        )
        if not has_pending:
            return

        self.config.ensure_dirs()

        lock = filelock.FileLock(str(self._lock_path), timeout=10)
        try:
            with lock:
                disk_state = read_json_safe(self.config.state_file, default={})
                disk_state = self._ensure_state_schema(disk_state)

                # progress（合并为 max(chapter) + words_delta 累加）
                if self._pending_progress_chapter is not None or self._pending_progress_words_delta != 0:
                    progress = disk_state.get("progress", {})
                    if not isinstance(progress, dict):
                        progress = {}
                        disk_state["progress"] = progress

                    try:
                        current_chapter = int(progress.get("current_chapter", 0) or 0)
                    except (TypeError, ValueError):
                        current_chapter = 0

                    if self._pending_progress_chapter is not None:
                        progress["current_chapter"] = max(current_chapter, int(self._pending_progress_chapter))

                    if self._pending_progress_words_delta:
                        try:
                            total_words = int(progress.get("total_words", 0) or 0)
                        except (TypeError, ValueError):
                            total_words = 0
                        progress["total_words"] = total_words + int(self._pending_progress_words_delta)

                    progress["last_updated"] = self._now_progress_timestamp()

                # v5.1: 检查是否已迁移到 SQLite
                # 如果启用了 SQLite 同步，则不再写入大数据字段到 state.json
                _migrated = self._enable_sqlite_sync and self._sql_state_manager is not None

                if not _migrated:
                    # ==================== 旧模式：写入 state.json ====================
                    # entities_v3（按补丁应用）
                    entities_v3 = disk_state.get("entities_v3", {})
                    if not isinstance(entities_v3, dict):
                        entities_v3 = {}
                        disk_state["entities_v3"] = entities_v3
                    for t in self.ENTITY_TYPES:
                        if not isinstance(entities_v3.get(t), dict):
                            entities_v3[t] = {}

                    for (entity_type, entity_id), patch in self._pending_entity_patches.items():
                        bucket = entities_v3.setdefault(entity_type, {})
                        if not isinstance(bucket, dict):
                            bucket = {}
                            entities_v3[entity_type] = bucket

                        entity = bucket.get(entity_id)
                        if not isinstance(entity, dict):
                            entity = {}
                            bucket[entity_id] = entity

                        # 新建实体时：只填充缺失字段，避免覆盖并发写入的更完整信息
                        if patch.base_entity:
                            for k, v in patch.base_entity.items():
                                if k not in entity:
                                    entity[k] = v
                                elif isinstance(entity.get(k), dict) and isinstance(v, dict):
                                    # 递归填充缺失
                                    for kk, vv in v.items():
                                        if kk not in entity[k]:
                                            entity[k][kk] = vv

                        # top-level updates（明确写入）
                        for k, v in patch.top_updates.items():
                            entity[k] = v

                        # current updates（明确写入）
                        if patch.current_updates:
                            current = entity.get("current")
                            if not isinstance(current, dict):
                                current = {}
                                entity["current"] = current
                            current.update(patch.current_updates)

                        # appearance updates（first=min(non-zero), last=max）
                        if patch.appearance_chapter is not None:
                            chapter = int(patch.appearance_chapter)
                            try:
                                first = int(entity.get("first_appearance", 0) or 0)
                            except (TypeError, ValueError):
                                first = 0
                            try:
                                last = int(entity.get("last_appearance", 0) or 0)
                            except (TypeError, ValueError):
                                last = 0

                            if first <= 0:
                                entity["first_appearance"] = chapter
                            else:
                                entity["first_appearance"] = min(first, chapter)
                            entity["last_appearance"] = max(last, chapter)

                    # alias_index（一对多：合并去重）
                    alias_index = disk_state.get("alias_index", {})
                    if not isinstance(alias_index, dict):
                        alias_index = {}
                        disk_state["alias_index"] = alias_index

                    for alias, entries in self._pending_alias_entries.items():
                        if not alias:
                            continue
                        existing = alias_index.get(alias)
                        if not isinstance(existing, list):
                            existing = []
                            alias_index[alias] = existing

                        for entry in entries:
                            et = entry.get("type")
                            eid = entry.get("id")
                            if not et or not eid:
                                continue
                            if any(e.get("type") == et and e.get("id") == eid for e in existing if isinstance(e, dict)):
                                continue
                            existing.append({"type": et, "id": eid})

                    # state_changes（追加）
                    if self._pending_state_changes:
                        changes = disk_state.get("state_changes")
                        if not isinstance(changes, list):
                            changes = []
                            disk_state["state_changes"] = changes
                        changes.extend(self._pending_state_changes)

                    # structured_relationships（追加去重）
                    if self._pending_structured_relationships:
                        rels = disk_state.get("structured_relationships")
                        if not isinstance(rels, list):
                            rels = []
                            disk_state["structured_relationships"] = rels

                        def _rel_key(r: Dict[str, Any]) -> tuple:
                            return (
                                r.get("from_entity"),
                                r.get("to_entity"),
                                r.get("type"),
                                r.get("description"),
                                r.get("chapter"),
                            )

                        existing_keys = {_rel_key(r) for r in rels if isinstance(r, dict)}
                        for r in self._pending_structured_relationships:
                            if not isinstance(r, dict):
                                continue
                            k = _rel_key(r)
                            if k in existing_keys:
                                continue
                            rels.append(r)
                            existing_keys.add(k)
                else:
                    # ==================== v5.1 模式：移除大数据字段 ====================
                    # 确保 state.json 中不存在这些膨胀字段
                    for field in ["entities_v3", "alias_index", "state_changes", "structured_relationships"]:
                        disk_state.pop(field, None)
                    # 标记已迁移
                    disk_state["_migrated_to_sqlite"] = True

                # disambiguation_warnings（追加去重 + 截断）
                if self._pending_disambiguation_warnings:
                    warnings_list = disk_state.get("disambiguation_warnings")
                    if not isinstance(warnings_list, list):
                        warnings_list = []
                        disk_state["disambiguation_warnings"] = warnings_list

                    def _warn_key(w: Dict[str, Any]) -> tuple:
                        return (
                            w.get("chapter"),
                            w.get("mention"),
                            w.get("chosen_id"),
                            w.get("confidence"),
                        )

                    existing_keys = {_warn_key(w) for w in warnings_list if isinstance(w, dict)}
                    for w in self._pending_disambiguation_warnings:
                        if not isinstance(w, dict):
                            continue
                        k = _warn_key(w)
                        if k in existing_keys:
                            continue
                        warnings_list.append(w)
                        existing_keys.add(k)

                    # 只保留最近 N 条，避免文件无限增长
                    max_keep = self.config.max_disambiguation_warnings
                    if len(warnings_list) > max_keep:
                        disk_state["disambiguation_warnings"] = warnings_list[-max_keep:]

                # disambiguation_pending（追加去重 + 截断）
                if self._pending_disambiguation_pending:
                    pending_list = disk_state.get("disambiguation_pending")
                    if not isinstance(pending_list, list):
                        pending_list = []
                        disk_state["disambiguation_pending"] = pending_list

                    def _pending_key(w: Dict[str, Any]) -> tuple:
                        return (
                            w.get("chapter"),
                            w.get("mention"),
                            w.get("suggested_id"),
                            w.get("confidence"),
                        )

                    existing_keys = {_pending_key(w) for w in pending_list if isinstance(w, dict)}
                    for w in self._pending_disambiguation_pending:
                        if not isinstance(w, dict):
                            continue
                        k = _pending_key(w)
                        if k in existing_keys:
                            continue
                        pending_list.append(w)
                        existing_keys.add(k)

                    max_keep = self.config.max_disambiguation_pending
                    if len(pending_list) > max_keep:
                        disk_state["disambiguation_pending"] = pending_list[-max_keep:]

                # 原子写入（锁已持有，不再二次加锁）
                atomic_write_json(self.config.state_file, disk_state, use_lock=False, backup=True)

                # v5.1: 同步到 SQLite（必须在清空 pending 之前调用）
                self._sync_to_sqlite()

                # 同步内存为磁盘最新快照，并清空增量队列
                self._state = disk_state
                self._pending_entity_patches.clear()
                self._pending_alias_entries.clear()
                self._pending_state_changes.clear()
                self._pending_structured_relationships.clear()
                self._pending_disambiguation_warnings.clear()
                self._pending_disambiguation_pending.clear()
                self._pending_progress_chapter = None
                self._pending_progress_words_delta = 0

        except filelock.Timeout:
            raise RuntimeError("无法获取 state.json 文件锁，请稍后重试")

    def _sync_to_sqlite(self):
        """v5.1: 同步待处理数据到 SQLite"""
        if not self._sql_state_manager:
            return

        # 方式1: 通过 process_chapter_result 收集的数据
        sqlite_data = self._pending_sqlite_data
        chapter = sqlite_data.get("chapter")

        # 记录已处理的 (entity_id, chapter) 组合，避免重复写入 appearances
        processed_appearances = set()

        if chapter is not None:
            try:
                self._sql_state_manager.process_chapter_entities(
                    chapter=chapter,
                    entities_appeared=sqlite_data.get("entities_appeared", []),
                    entities_new=sqlite_data.get("entities_new", []),
                    state_changes=sqlite_data.get("state_changes", []),
                    relationships_new=sqlite_data.get("relationships_new", [])
                )
                # 标记已处理的出场记录
                for entity in sqlite_data.get("entities_appeared", []):
                    if entity.get("id"):
                        processed_appearances.add((entity.get("id"), chapter))
                for entity in sqlite_data.get("entities_new", []):
                    eid = entity.get("suggested_id") or entity.get("id")
                    if eid:
                        processed_appearances.add((eid, chapter))
            except Exception:
                pass  # SQLite 同步失败时静默降级，不影响主流程

        # 方式2: 通过 add_entity/update_entity 等直接调用收集的数据
        # 这些数据存储在 _pending_entity_patches 等变量中
        self._sync_pending_patches_to_sqlite(processed_appearances)

        # 清空
        self._clear_pending_sqlite_data()

    def _sync_pending_patches_to_sqlite(self, processed_appearances: set = None):
        """v5.1: 同步 _pending_entity_patches 等到 SQLite

        Args:
            processed_appearances: 已通过 process_chapter_entities 处理的 (entity_id, chapter) 集合，
                                   用于避免重复写入 appearances 表（防止覆盖 mentions）
        """
        if not self._sql_state_manager:
            return

        if processed_appearances is None:
            processed_appearances = set()

        # 元数据字段（不应写入 current_json）
        METADATA_FIELDS = {"canonical_name", "tier", "desc", "is_protagonist", "is_archived"}

        try:
            from .sql_state_manager import EntityData
            from .index_manager import EntityMeta

            # 同步实体补丁
            for (entity_type, entity_id), patch in self._pending_entity_patches.items():
                if patch.base_entity:
                    # 新实体
                    entity_data = EntityData(
                        id=entity_id,
                        type=entity_type,
                        name=patch.base_entity.get("canonical_name", entity_id),
                        tier=patch.base_entity.get("tier", "装饰"),
                        desc=patch.base_entity.get("desc", ""),
                        current=patch.base_entity.get("current", {}),
                        aliases=[],
                        first_appearance=patch.base_entity.get("first_appearance", 0),
                        last_appearance=patch.base_entity.get("last_appearance", 0),
                        is_protagonist=patch.base_entity.get("is_protagonist", False)
                    )
                    self._sql_state_manager.upsert_entity(entity_data)

                    # 记录首次出场（跳过已处理的，避免覆盖 mentions）
                    if patch.appearance_chapter is not None:
                        if (entity_id, patch.appearance_chapter) not in processed_appearances:
                            self._sql_state_manager._index_manager.record_appearance(
                                entity_id=entity_id,
                                chapter=patch.appearance_chapter,
                                mentions=[entity_data.name],
                                confidence=1.0
                            )
                else:
                    # 更新现有实体
                    has_metadata_updates = bool(patch.top_updates and
                                                 any(k in METADATA_FIELDS for k in patch.top_updates))

                    if has_metadata_updates:
                        # 有元数据更新：使用 upsert_entity(update_metadata=True)
                        existing = self._sql_state_manager.get_entity(entity_id)
                        if existing:
                            # 合并 current_updates
                            current = existing.get("current_json", {})
                            if isinstance(current, str):
                                import json
                                current = json.loads(current) if current else {}
                            if patch.current_updates:
                                current.update(patch.current_updates)

                            new_canonical_name = patch.top_updates.get("canonical_name")
                            old_canonical_name = existing.get("canonical_name", "")

                            entity_meta = EntityMeta(
                                id=entity_id,
                                type=existing.get("type", entity_type),
                                canonical_name=new_canonical_name or old_canonical_name,
                                tier=patch.top_updates.get("tier", existing.get("tier", "装饰")),
                                desc=patch.top_updates.get("desc", existing.get("desc", "")),
                                current=current,
                                first_appearance=existing.get("first_appearance", 0),
                                last_appearance=patch.appearance_chapter or existing.get("last_appearance", 0),
                                is_protagonist=patch.top_updates.get("is_protagonist", existing.get("is_protagonist", False)),
                                is_archived=patch.top_updates.get("is_archived", existing.get("is_archived", False))
                            )
                            self._sql_state_manager._index_manager.upsert_entity(entity_meta, update_metadata=True)

                            # 如果 canonical_name 改名，自动注册新名字为 alias
                            if new_canonical_name and new_canonical_name != old_canonical_name:
                                self._sql_state_manager.register_alias(
                                    new_canonical_name, entity_id, existing.get("type", entity_type)
                                )
                    elif patch.current_updates:
                        # 只有 current 更新
                        self._sql_state_manager.update_entity_current(entity_id, patch.current_updates)

                    # 更新 last_appearance 并记录出场（跳过已处理的，避免覆盖 mentions）
                    if patch.appearance_chapter is not None:
                        self._sql_state_manager._update_last_appearance(entity_id, patch.appearance_chapter)
                        # 补充 appearances 记录（仅当未被 process_chapter_entities 处理时）
                        if (entity_id, patch.appearance_chapter) not in processed_appearances:
                            self._sql_state_manager._index_manager.record_appearance(
                                entity_id=entity_id,
                                chapter=patch.appearance_chapter,
                                mentions=[],
                                confidence=1.0
                            )

            # 同步别名
            for alias, entries in self._pending_alias_entries.items():
                for entry in entries:
                    entity_type = entry.get("type")
                    entity_id = entry.get("id")
                    if entity_type and entity_id:
                        self._sql_state_manager.register_alias(alias, entity_id, entity_type)

            # 同步状态变化
            for change in self._pending_state_changes:
                self._sql_state_manager.record_state_change(
                    entity_id=change.get("entity_id", ""),
                    field=change.get("field", ""),
                    old_value=change.get("old", change.get("old_value", "")),
                    new_value=change.get("new", change.get("new_value", "")),
                    reason=change.get("reason", ""),
                    chapter=change.get("chapter", 0)
                )

            # 同步关系
            for rel in self._pending_structured_relationships:
                self._sql_state_manager.upsert_relationship(
                    from_entity=rel.get("from_entity", ""),
                    to_entity=rel.get("to_entity", ""),
                    type=rel.get("type", "相识"),
                    description=rel.get("description", ""),
                    chapter=rel.get("chapter", 0)
                )

        except Exception:
            pass  # SQLite 同步失败时静默降级

    def _clear_pending_sqlite_data(self):
        """清空待同步的 SQLite 数据"""
        self._pending_sqlite_data = {
            "entities_appeared": [],
            "entities_new": [],
            "state_changes": [],
            "relationships_new": [],
            "chapter": None
        }

    # ==================== 进度管理 ====================

    def get_current_chapter(self) -> int:
        """获取当前章节号"""
        return self._state.get("progress", {}).get("current_chapter", 0)

    def update_progress(self, chapter: int, words: int = 0):
        """更新进度"""
        if "progress" not in self._state:
            self._state["progress"] = {}
        self._state["progress"]["current_chapter"] = chapter
        if words > 0:
            total = self._state["progress"].get("total_words", 0)
            self._state["progress"]["total_words"] = total + words

        # 记录增量：锁内合并时用 max(chapter) + words_delta 累加
        if self._pending_progress_chapter is None:
            self._pending_progress_chapter = chapter
        else:
            self._pending_progress_chapter = max(self._pending_progress_chapter, chapter)
        if words > 0:
            self._pending_progress_words_delta += int(words)

    # ==================== 实体管理 (v5.0 entities_v3) ====================

    def get_entity(self, entity_id: str, entity_type: str = None) -> Optional[Dict]:
        """获取实体 (v5.0 entities_v3 格式)"""
        entities_v3 = self._state.get("entities_v3", {})

        if entity_type:
            return entities_v3.get(entity_type, {}).get(entity_id)

        # 遍历所有类型查找
        for type_name, entities in entities_v3.items():
            if entity_id in entities:
                return entities[entity_id]
        return None

    def get_entity_type(self, entity_id: str) -> Optional[str]:
        """获取实体所属类型"""
        for type_name, entities in self._state.get("entities_v3", {}).items():
            if entity_id in entities:
                return type_name
        return None

    def get_all_entities(self) -> Dict[str, Dict]:
        """获取所有实体（扁平化视图，兼容旧代码）"""
        result = {}
        for type_name, entities in self._state.get("entities_v3", {}).items():
            for eid, e in entities.items():
                result[eid] = {**e, "type": type_name}
        return result

    def get_entities_by_type(self, entity_type: str) -> Dict[str, Dict]:
        """按类型获取实体"""
        return self._state.get("entities_v3", {}).get(entity_type, {})

    def get_entities_by_tier(self, tier: str) -> Dict[str, Dict]:
        """按层级获取实体"""
        result = {}
        for type_name, entities in self._state.get("entities_v3", {}).items():
            for eid, e in entities.items():
                if e.get("tier") == tier:
                    result[eid] = {**e, "type": type_name}
        return result

    def add_entity(self, entity: EntityState) -> bool:
        """添加新实体 (v5.0 entities_v3 格式)"""
        entity_type = entity.type
        if entity_type not in self.ENTITY_TYPES:
            entity_type = "角色"

        if "entities_v3" not in self._state:
            self._state["entities_v3"] = {t: {} for t in self.ENTITY_TYPES}

        if entity_type not in self._state["entities_v3"]:
            self._state["entities_v3"][entity_type] = {}

        # 检查是否已存在
        if entity.id in self._state["entities_v3"][entity_type]:
            return False

        # 转换为 v3 格式
        v3_entity = {
            "canonical_name": entity.name,
            "tier": entity.tier,
            "desc": "",
            "current": entity.attributes,
            "first_appearance": entity.first_appearance,
            "last_appearance": entity.last_appearance,
            "history": []
        }
        self._state["entities_v3"][entity_type][entity.id] = v3_entity

        # 记录实体补丁（新建：仅填充缺失字段，避免覆盖并发写入）
        patch = self._pending_entity_patches.get((entity_type, entity.id))
        if patch is None:
            patch = _EntityPatch(entity_type=entity_type, entity_id=entity.id)
            self._pending_entity_patches[(entity_type, entity.id)] = patch
        patch.replace = True
        patch.base_entity = v3_entity

        # 注册别名到 alias_index
        self._register_alias_internal(entity.id, entity_type, entity.name)
        for alias in entity.aliases:
            self._register_alias_internal(entity.id, entity_type, alias)

        return True

    def _register_alias_internal(self, entity_id: str, entity_type: str, alias: str):
        """内部方法：注册别名到 state.json 的 alias_index"""
        if not alias:
            return
        if "alias_index" not in self._state:
            self._state["alias_index"] = {}

        if alias not in self._state["alias_index"]:
            self._state["alias_index"][alias] = []

        # 检查是否已存在
        exists = any(
            e.get("type") == entity_type and e.get("id") == entity_id
            for e in self._state["alias_index"][alias]
        )
        if not exists:
            self._state["alias_index"][alias].append({
                "type": entity_type,
                "id": entity_id
            })
            # 记录待合并增量：避免锁外读-改-写覆盖
            pending = self._pending_alias_entries.setdefault(alias, [])
            if not any(e.get("type") == entity_type and e.get("id") == entity_id for e in pending):
                pending.append({"type": entity_type, "id": entity_id})

    def update_entity(self, entity_id: str, updates: Dict[str, Any], entity_type: str = None) -> bool:
        """更新实体属性 (v5.0)"""
        # 查找实体
        if entity_type:
            if entity_id not in self._state.get("entities_v3", {}).get(entity_type, {}):
                return False
            entity = self._state["entities_v3"][entity_type][entity_id]
        else:
            entity_type = self.get_entity_type(entity_id)
            if not entity_type:
                return False
            entity = self._state["entities_v3"][entity_type][entity_id]

        for key, value in updates.items():
            if key == "attributes" and isinstance(value, dict):
                # v5.0: attributes 存在 current 字段
                if "current" not in entity:
                    entity["current"] = {}
                entity["current"].update(value)
                # 记录补丁（current 增量）
                patch = self._pending_entity_patches.get((entity_type, entity_id))
                if patch is None:
                    patch = _EntityPatch(entity_type=entity_type, entity_id=entity_id)
                    self._pending_entity_patches[(entity_type, entity_id)] = patch
                patch.current_updates.update(value)
            elif key == "current" and isinstance(value, dict):
                if "current" not in entity:
                    entity["current"] = {}
                entity["current"].update(value)
                patch = self._pending_entity_patches.get((entity_type, entity_id))
                if patch is None:
                    patch = _EntityPatch(entity_type=entity_type, entity_id=entity_id)
                    self._pending_entity_patches[(entity_type, entity_id)] = patch
                patch.current_updates.update(value)
            else:
                entity[key] = value
                patch = self._pending_entity_patches.get((entity_type, entity_id))
                if patch is None:
                    patch = _EntityPatch(entity_type=entity_type, entity_id=entity_id)
                    self._pending_entity_patches[(entity_type, entity_id)] = patch
                patch.top_updates[key] = value

        return True

    def update_entity_appearance(self, entity_id: str, chapter: int, entity_type: str = None):
        """更新实体出场章节"""
        if not entity_type:
            entity_type = self.get_entity_type(entity_id)
        if not entity_type:
            return

        entity = self._state["entities_v3"][entity_type].get(entity_id)
        if entity:
            if entity.get("first_appearance", 0) == 0:
                entity["first_appearance"] = chapter
            entity["last_appearance"] = chapter

            # 记录补丁：锁内应用 first=min(non-zero), last=max
            patch = self._pending_entity_patches.get((entity_type, entity_id))
            if patch is None:
                patch = _EntityPatch(entity_type=entity_type, entity_id=entity_id)
                self._pending_entity_patches[(entity_type, entity_id)] = patch
            if patch.appearance_chapter is None:
                patch.appearance_chapter = chapter
            else:
                patch.appearance_chapter = max(int(patch.appearance_chapter), int(chapter))

    # ==================== 状态变化记录 ====================

    def record_state_change(
        self,
        entity_id: str,
        field: str,
        old_value: Any,
        new_value: Any,
        reason: str,
        chapter: int
    ):
        """记录状态变化"""
        if "state_changes" not in self._state:
            self._state["state_changes"] = []

        change = StateChange(
            entity_id=entity_id,
            field=field,
            old_value=old_value,
            new_value=new_value,
            reason=reason,
            chapter=chapter
        )
        change_dict = asdict(change)
        self._state["state_changes"].append(change_dict)
        self._pending_state_changes.append(change_dict)

        # 同时更新实体属性
        self.update_entity(entity_id, {"attributes": {field: new_value}})

    def get_state_changes(self, entity_id: Optional[str] = None) -> List[Dict]:
        """获取状态变化历史"""
        changes = self._state.get("state_changes", [])
        if entity_id:
            changes = [c for c in changes if c.get("entity_id") == entity_id]
        return changes

    # ==================== 关系管理 ====================

    def add_relationship(
        self,
        from_entity: str,
        to_entity: str,
        rel_type: str,
        description: str,
        chapter: int
    ):
        """添加关系"""
        rel = Relationship(
            from_entity=from_entity,
            to_entity=to_entity,
            type=rel_type,
            description=description,
            chapter=chapter
        )

        # v5.0: 实体关系存入 structured_relationships，避免与 relationships(人物关系字典) 冲突
        if "structured_relationships" not in self._state:
            self._state["structured_relationships"] = []
        rel_dict = asdict(rel)
        self._state["structured_relationships"].append(rel_dict)
        self._pending_structured_relationships.append(rel_dict)

    def get_relationships(self, entity_id: Optional[str] = None) -> List[Dict]:
        """获取关系列表"""
        rels = self._state.get("structured_relationships", [])
        if entity_id:
            rels = [
                r for r in rels
                if r.get("from_entity") == entity_id or r.get("to_entity") == entity_id
            ]
        return rels

    # ==================== 批量操作 ====================

    def _record_disambiguation(self, chapter: int, uncertain_items: Any) -> List[str]:
        """
        记录消歧反馈到 state.json，便于 Writer/Context Agent 感知风险。

        约定：
        - >= extraction_confidence_medium：写入 disambiguation_warnings（采用但警告）
        - < extraction_confidence_medium：写入 disambiguation_pending（需人工确认）
        """
        if not isinstance(uncertain_items, list) or not uncertain_items:
            return []

        warnings: List[str] = []
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        for item in uncertain_items:
            if not isinstance(item, dict):
                continue

            mention = str(item.get("mention", "") or "").strip()
            if not mention:
                continue

            raw_conf = item.get("confidence", 0.0)
            try:
                confidence = float(raw_conf)
            except (TypeError, ValueError):
                confidence = 0.0

            # 候选：支持 [{"type","id"}...] 或 ["id1","id2"] 两种形式
            candidates_raw = item.get("candidates", [])
            candidates: List[Dict[str, str]] = []
            if isinstance(candidates_raw, list):
                for c in candidates_raw:
                    if isinstance(c, dict):
                        cid = str(c.get("id", "") or "").strip()
                        ctype = str(c.get("type", "") or "").strip()
                        entry: Dict[str, str] = {}
                        if ctype:
                            entry["type"] = ctype
                        if cid:
                            entry["id"] = cid
                        if entry:
                            candidates.append(entry)
                    else:
                        cid = str(c).strip()
                        if cid:
                            candidates.append({"id": cid})

            entity_type = str(item.get("type", "") or "").strip()
            suggested_id = str(item.get("suggested", "") or "").strip()

            adopted_raw = item.get("adopted", None)
            chosen_id = ""
            if isinstance(adopted_raw, str):
                chosen_id = adopted_raw.strip()
            elif adopted_raw is True:
                chosen_id = suggested_id
            else:
                # 兼容字段名：entity_id / chosen_id
                chosen_id = str(item.get("entity_id") or item.get("chosen_id") or "").strip() or suggested_id

            context = str(item.get("context", "") or "").strip()
            note = str(item.get("warning", "") or "").strip()

            record: Dict[str, Any] = {
                "chapter": int(chapter),
                "mention": mention,
                "type": entity_type,
                "suggested_id": suggested_id,
                "chosen_id": chosen_id,
                "confidence": confidence,
                "candidates": candidates,
                "context": context,
                "note": note,
                "created_at": now,
            }

            if confidence >= float(self.config.extraction_confidence_medium):
                self._state.setdefault("disambiguation_warnings", []).append(record)
                self._pending_disambiguation_warnings.append(record)
                chosen_part = f" → {chosen_id}" if chosen_id else ""
                warnings.append(f"消歧警告: {mention}{chosen_part} (confidence: {confidence:.2f})")
            else:
                self._state.setdefault("disambiguation_pending", []).append(record)
                self._pending_disambiguation_pending.append(record)
                warnings.append(f"消歧需人工确认: {mention} (confidence: {confidence:.2f})")

        return warnings

    def process_chapter_result(self, chapter: int, result: Dict) -> List[str]:
        """
        处理 Data Agent 的章节处理结果 (v5.1)

        输入格式:
        - entities_appeared: 出场实体列表
        - entities_new: 新实体列表
        - state_changes: 状态变化列表
        - relationships_new: 新关系列表

        返回警告列表
        """
        warnings = []

        # v5.1: 记录章节号用于 SQLite 同步
        self._pending_sqlite_data["chapter"] = chapter

        # 处理出场实体
        for entity in result.get("entities_appeared", []):
            entity_id = entity.get("id")
            entity_type = entity.get("type")
            if entity_id:
                self.update_entity_appearance(entity_id, chapter, entity_type)
                # v5.1: 缓存用于 SQLite 同步
                self._pending_sqlite_data["entities_appeared"].append(entity)

        # 处理新实体
        for entity in result.get("entities_new", []):
            entity_id = entity.get("suggested_id") or entity.get("id")
            if entity_id and entity_id != "NEW":
                new_entity = EntityState(
                    id=entity_id,
                    name=entity.get("name", ""),
                    type=entity.get("type", "角色"),
                    tier=entity.get("tier", "装饰"),
                    aliases=entity.get("mentions", []),
                    first_appearance=chapter,
                    last_appearance=chapter
                )
                if not self.add_entity(new_entity):
                    warnings.append(f"实体已存在: {entity_id}")
                # v5.1: 缓存用于 SQLite 同步
                self._pending_sqlite_data["entities_new"].append(entity)

        # 处理状态变化
        for change in result.get("state_changes", []):
            self.record_state_change(
                entity_id=change.get("entity_id", ""),
                field=change.get("field", ""),
                old_value=change.get("old"),
                new_value=change.get("new"),
                reason=change.get("reason", ""),
                chapter=chapter
            )
            # v5.1: 缓存用于 SQLite 同步
            self._pending_sqlite_data["state_changes"].append(change)

        # 处理关系
        for rel in result.get("relationships_new", []):
            self.add_relationship(
                from_entity=rel.get("from", ""),
                to_entity=rel.get("to", ""),
                rel_type=rel.get("type", ""),
                description=rel.get("description", ""),
                chapter=chapter
            )
            # v5.1: 缓存用于 SQLite 同步
            self._pending_sqlite_data["relationships_new"].append(rel)

        # 处理消歧不确定项（不影响实体写入，但必须对 Writer 可见）
        warnings.extend(self._record_disambiguation(chapter, result.get("uncertain", [])))

        # 更新进度
        self.update_progress(chapter)

        # 同步主角状态（entities_v3 → protagonist_state）
        self.sync_protagonist_from_entity()

        return warnings

    # ==================== 导出 ====================

    def export_for_context(self) -> Dict:
        """导出用于上下文的精简版状态 (v5.0)"""
        # 从 entities_v3 构建精简视图
        entities_flat = {}
        for type_name, entities in self._state.get("entities_v3", {}).items():
            for eid, e in entities.items():
                entities_flat[eid] = {
                    "name": e.get("canonical_name", eid),
                    "type": type_name,
                    "tier": e.get("tier", "装饰"),
                    "current": e.get("current", {})
                }

        return {
            "progress": self._state.get("progress", {}),
            "entities": entities_flat,
            "alias_index": self._state.get("alias_index", {}),
            "recent_changes": self._state.get("state_changes", [])[-self.config.export_recent_changes_slice:],
            "disambiguation": {
                "warnings": self._state.get("disambiguation_warnings", [])[-self.config.export_disambiguation_slice:],
                "pending": self._state.get("disambiguation_pending", [])[-self.config.export_disambiguation_slice:],
            },
        }

    # ==================== 主角同步 ====================

    def get_protagonist_entity_id(self) -> Optional[str]:
        """获取主角实体 ID（通过 is_protagonist 标记或 protagonist_state.name 查找）"""
        # 方式1: 查找 is_protagonist 标记
        for eid, e in self._state.get("entities_v3", {}).get("角色", {}).items():
            if e.get("is_protagonist"):
                return eid

        # 方式2: 通过 protagonist_state.name 查找
        protag_name = self._state.get("protagonist_state", {}).get("name")
        if protag_name:
            alias_entries = self._state.get("alias_index", {}).get(protag_name, [])
            for entry in alias_entries:
                if entry.get("type") == "角色":
                    return entry.get("id")

        return None

    def sync_protagonist_from_entity(self, entity_id: str = None):
        """
        将 entities_v3 中主角实体的状态同步到 protagonist_state

        用于确保 consistency-checker 等依赖 protagonist_state 的组件获取最新数据
        """
        if entity_id is None:
            entity_id = self.get_protagonist_entity_id()
        if entity_id is None:
            return

        entity = self.get_entity(entity_id, "角色")
        if not entity:
            return

        current = entity.get("current", {})
        protag = self._state.setdefault("protagonist_state", {})

        # 同步境界
        if "realm" in current:
            power = protag.setdefault("power", {})
            power["realm"] = current["realm"]
            if "layer" in current:
                power["layer"] = current["layer"]

        # 同步位置
        if "location" in current:
            loc = protag.setdefault("location", {})
            loc["current"] = current["location"]
            if "last_chapter" in current:
                loc["last_chapter"] = current["last_chapter"]

    def sync_protagonist_to_entity(self, entity_id: str = None):
        """
        将 protagonist_state 同步到 entities_v3 中的主角实体

        用于初始化或手动编辑 protagonist_state 后保持一致性
        """
        if entity_id is None:
            entity_id = self.get_protagonist_entity_id()
        if entity_id is None:
            return

        protag = self._state.get("protagonist_state", {})
        if not protag:
            return

        updates = {}

        # 同步境界
        power = protag.get("power", {})
        if power.get("realm"):
            updates["realm"] = power["realm"]
        if power.get("layer"):
            updates["layer"] = power["layer"]

        # 同步位置
        loc = protag.get("location", {})
        if loc.get("current"):
            updates["location"] = loc["current"]

        if updates:
            self.update_entity(entity_id, updates, "角色")


# ==================== CLI 接口 ====================

def main():
    import argparse

    parser = argparse.ArgumentParser(description="State Manager CLI")
    parser.add_argument("--project-root", type=str, help="项目根目录")

    subparsers = parser.add_subparsers(dest="command")

    # 获取进度
    subparsers.add_parser("get-progress")

    # 获取实体
    get_entity_parser = subparsers.add_parser("get-entity")
    get_entity_parser.add_argument("--id", required=True, help="实体ID")

    # 列出实体
    list_parser = subparsers.add_parser("list-entities")
    list_parser.add_argument("--type", help="按类型过滤")
    list_parser.add_argument("--tier", help="按层级过滤")

    # 处理章节结果
    process_parser = subparsers.add_parser("process-chapter")
    process_parser.add_argument("--chapter", type=int, required=True, help="章节号")
    process_parser.add_argument("--data", required=True, help="JSON 格式的处理结果")

    args = parser.parse_args()

    # 初始化
    config = None
    if args.project_root:
        from .config import DataModulesConfig
        config = DataModulesConfig.from_project_root(args.project_root)

    manager = StateManager(config)

    if args.command == "get-progress":
        print(json.dumps(manager._state.get("progress", {}), ensure_ascii=False, indent=2))

    elif args.command == "get-entity":
        entity = manager.get_entity(args.id)
        if entity:
            print(json.dumps(entity, ensure_ascii=False, indent=2))
        else:
            print(f"未找到实体: {args.id}")

    elif args.command == "list-entities":
        if args.type:
            entities = manager.get_entities_by_type(args.type)
        elif args.tier:
            entities = manager.get_entities_by_tier(args.tier)
        else:
            entities = manager.get_all_entities()

        for eid, e in entities.items():
            print(f"{eid}: {e.get('name')} ({e.get('type')}/{e.get('tier')})")

    elif args.command == "process-chapter":
        data = json.loads(args.data)
        warnings = manager.process_chapter_result(args.chapter, data)
        manager.save_state()

        print(f"✓ 已处理第 {args.chapter} 章")
        if warnings:
            print("警告:")
            for w in warnings:
                print(f"  - {w}")


if __name__ == "__main__":
    main()
