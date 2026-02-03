#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SQL State Manager - SQLite 状态管理模块 (v5.4)

基于 IndexManager 扩展，提供与 StateManager 兼容的高级接口，
将大数据（实体、别名、状态变化、关系）存储到 SQLite 而非 JSON。

目标（v5.1 引入，v5.4 沿用）：
- 替代 state.json 中的大数据字段
- 保持与 Data Agent / Context Agent 的接口兼容
- 支持增量写入和按需查询
"""

import json
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime

from .index_manager import (
    IndexManager,
    EntityMeta,
    StateChangeMeta,
    RelationshipMeta
)
from .config import get_config


@dataclass
class EntityData:
    """实体数据（用于 Data Agent 输入）"""
    id: str
    type: str  # 角色/地点/物品/势力/招式
    name: str
    tier: str = "装饰"
    desc: str = ""
    current: Dict[str, Any] = field(default_factory=dict)
    aliases: List[str] = field(default_factory=list)
    first_appearance: int = 0
    last_appearance: int = 0
    is_protagonist: bool = False


class SQLStateManager:
    """
    SQLite 状态管理器（v5.1 引入，v5.4 沿用）

    提供与 StateManager 兼容的接口，但数据存储在 SQLite (index.db) 中。
    用于替代 state.json 中膨胀的数据结构。

    用法:
    ```python
    manager = SQLStateManager(config)

    # 写入实体
    manager.upsert_entity(EntityData(
        id="xiaoyan",
        type="角色",
        name="萧炎",
        tier="核心",
        current={"realm": "斗师", "location": "天云宗"},
        aliases=["小炎子", "废柴"],
        is_protagonist=True
    ))

    # 写入状态变化
    manager.record_state_change(
        entity_id="xiaoyan",
        field="realm",
        old_value="斗者",
        new_value="斗师",
        reason="闭关突破",
        chapter=100
    )

    # 写入关系
    manager.upsert_relationship(
        from_entity="xiaoyan",
        to_entity="yaolao",
        type="师徒",
        description="药老收萧炎为徒",
        chapter=5
    )

    # 读取
    protagonist = manager.get_protagonist()
    core_entities = manager.get_core_entities()
    changes = manager.get_recent_state_changes(limit=50)
    ```
    """

    # v5.0 引入的实体类型
    ENTITY_TYPES = ["角色", "地点", "物品", "势力", "招式"]

    def __init__(self, config=None):
        self.config = config or get_config()
        self._index_manager = IndexManager(config)

    # ==================== 实体操作 ====================

    def upsert_entity(self, entity: EntityData) -> bool:
        """
        插入或更新实体

        自动处理：
        - 实体基本信息写入 entities 表
        - 别名写入 aliases 表
        - canonical_name 自动添加为别名

        返回: 是否为新实体
        """
        # 构建 EntityMeta
        meta = EntityMeta(
            id=entity.id,
            type=entity.type,
            canonical_name=entity.name,
            tier=entity.tier,
            desc=entity.desc,
            current=entity.current,
            first_appearance=entity.first_appearance,
            last_appearance=entity.last_appearance,
            is_protagonist=entity.is_protagonist,
            is_archived=False
        )

        is_new = self._index_manager.upsert_entity(meta)

        # 注册别名
        # 1. canonical_name 本身作为别名
        self._index_manager.register_alias(entity.name, entity.id, entity.type)

        # 2. 其他别名
        for alias in entity.aliases:
            if alias and alias != entity.name:
                self._index_manager.register_alias(alias, entity.id, entity.type)

        return is_new

    def get_entity(self, entity_id: str) -> Optional[Dict]:
        """获取实体详情"""
        entity = self._index_manager.get_entity(entity_id)
        if entity:
            # 添加别名
            entity["aliases"] = self._index_manager.get_entity_aliases(entity_id)
        return entity

    def get_entities_by_type(self, entity_type: str, include_archived: bool = False) -> List[Dict]:
        """按类型获取实体"""
        entities = self._index_manager.get_entities_by_type(entity_type, include_archived)
        for e in entities:
            e["aliases"] = self._index_manager.get_entity_aliases(e["id"])
        return entities

    def get_core_entities(self) -> List[Dict]:
        """
        获取核心实体（用于 Context Agent 全量加载）

        返回所有 tier=核心/重要 或 is_protagonist=1 的实体
        （次要/装饰实体按需查询，不全量加载）
        """
        entities = self._index_manager.get_core_entities()
        for e in entities:
            e["aliases"] = self._index_manager.get_entity_aliases(e["id"])
        return entities

    def get_protagonist(self) -> Optional[Dict]:
        """获取主角实体"""
        protagonist = self._index_manager.get_protagonist()
        if protagonist:
            protagonist["aliases"] = self._index_manager.get_entity_aliases(protagonist["id"])
        return protagonist

    def update_entity_current(self, entity_id: str, updates: Dict) -> bool:
        """增量更新实体的 current 字段"""
        return self._index_manager.update_entity_current(entity_id, updates)

    def resolve_alias(self, alias: str) -> List[Dict]:
        """
        根据别名解析实体（一对多）

        返回所有匹配的实体
        """
        return self._index_manager.get_entities_by_alias(alias)

    def register_alias(self, alias: str, entity_id: str, entity_type: str) -> bool:
        """注册别名"""
        return self._index_manager.register_alias(alias, entity_id, entity_type)

    # ==================== 状态变化操作 ====================

    def record_state_change(
        self,
        entity_id: str,
        field: str,
        old_value: Any,
        new_value: Any,
        reason: str,
        chapter: int
    ) -> int:
        """
        记录状态变化

        返回: 记录 ID
        """
        change = StateChangeMeta(
            entity_id=entity_id,
            field=field,
            old_value=str(old_value) if old_value is not None else "",
            new_value=str(new_value),
            reason=reason,
            chapter=chapter
        )
        return self._index_manager.record_state_change(change)

    def get_entity_state_changes(self, entity_id: str, limit: int = 20) -> List[Dict]:
        """获取实体的状态变化历史"""
        return self._index_manager.get_entity_state_changes(entity_id, limit)

    def get_recent_state_changes(self, limit: int = 50) -> List[Dict]:
        """获取最近的状态变化"""
        return self._index_manager.get_recent_state_changes(limit)

    def get_chapter_state_changes(self, chapter: int) -> List[Dict]:
        """获取某章的所有状态变化"""
        return self._index_manager.get_chapter_state_changes(chapter)

    # ==================== 关系操作 ====================

    def upsert_relationship(
        self,
        from_entity: str,
        to_entity: str,
        type: str,
        description: str,
        chapter: int
    ) -> bool:
        """
        插入或更新关系

        返回: 是否为新关系
        """
        rel = RelationshipMeta(
            from_entity=from_entity,
            to_entity=to_entity,
            type=type,
            description=description,
            chapter=chapter
        )
        return self._index_manager.upsert_relationship(rel)

    def get_entity_relationships(self, entity_id: str, direction: str = "both") -> List[Dict]:
        """获取实体的关系"""
        return self._index_manager.get_entity_relationships(entity_id, direction)

    def get_relationship_between(self, entity1: str, entity2: str) -> List[Dict]:
        """获取两个实体之间的所有关系"""
        return self._index_manager.get_relationship_between(entity1, entity2)

    def get_recent_relationships(self, limit: int = 30) -> List[Dict]:
        """获取最近建立的关系"""
        return self._index_manager.get_recent_relationships(limit)

    # ==================== 批量写入（供 Data Agent 使用） ====================

    def process_chapter_entities(
        self,
        chapter: int,
        entities_appeared: List[Dict],
        entities_new: List[Dict],
        state_changes: List[Dict],
        relationships_new: List[Dict]
    ) -> Dict[str, int]:
        """
        处理章节的实体数据（Data Agent 主入口）

        参数:
        - chapter: 章节号
        - entities_appeared: 出场的已有实体
          [{"id": "xiaoyan", "type": "角色", "mentions": ["萧炎", "他"], "confidence": 0.95}]
        - entities_new: 新发现的实体
          [{"suggested_id": "hongyi_girl", "name": "红衣女子", "type": "角色", "tier": "装饰"}]
        - state_changes: 状态变化
          [{"entity_id": "xiaoyan", "field": "realm", "old": "斗者", "new": "斗师", "reason": "突破"}]
        - relationships_new: 新关系
          [{"from": "xiaoyan", "to": "hongyi_girl", "type": "相识", "description": "初次见面"}]

        返回: 写入统计
        """
        stats = {
            "entities_updated": 0,
            "entities_created": 0,
            "state_changes": 0,
            "relationships": 0,
            "aliases": 0
        }

        # 1. 处理出场实体（更新 last_appearance）
        for entity in entities_appeared:
            entity_id = entity.get("id")
            if not entity_id:
                continue

            self._index_manager.update_entity_current(entity_id, {})  # 触发 updated_at
            # 更新 last_appearance
            existing = self._index_manager.get_entity(entity_id)
            if existing:
                # 使用 SQL 直接更新 last_appearance
                self._update_last_appearance(entity_id, chapter)
                stats["entities_updated"] += 1

            # 记录出场（保留原有逻辑）
            self._index_manager.record_appearance(
                entity_id=entity_id,
                chapter=chapter,
                mentions=entity.get("mentions", []),
                confidence=entity.get("confidence", 1.0)
            )

        # 2. 处理新实体
        for entity in entities_new:
            suggested_id = entity.get("suggested_id") or entity.get("id")
            if not suggested_id:
                continue

            entity_data = EntityData(
                id=suggested_id,
                type=entity.get("type", "角色"),
                name=entity.get("name", suggested_id),
                tier=entity.get("tier", "装饰"),
                desc=entity.get("desc", ""),
                current=entity.get("current", {}),
                aliases=entity.get("aliases", []),
                first_appearance=chapter,
                last_appearance=chapter,
                is_protagonist=entity.get("is_protagonist", False)
            )
            is_new = self.upsert_entity(entity_data)
            if is_new:
                stats["entities_created"] += 1
            else:
                stats["entities_updated"] += 1

            # 统计别名
            stats["aliases"] += 1 + len(entity_data.aliases)

            # 记录新实体的首次出场（解决 appearances 缺失问题）
            mentions = entity.get("mentions", [])
            if not mentions:
                mentions = [entity_data.name]  # 至少包含实体名
            self._index_manager.record_appearance(
                entity_id=suggested_id,
                chapter=chapter,
                mentions=mentions,
                confidence=entity.get("confidence", 1.0)
            )

        # 3. 处理状态变化
        for change in state_changes:
            entity_id = change.get("entity_id")
            if not entity_id:
                continue

            self.record_state_change(
                entity_id=entity_id,
                field=change.get("field", ""),
                old_value=change.get("old", change.get("old_value", "")),
                new_value=change.get("new", change.get("new_value", "")),
                reason=change.get("reason", ""),
                chapter=chapter
            )
            stats["state_changes"] += 1

            # 同步更新实体的 current
            field_name = change.get("field")
            new_value = change.get("new", change.get("new_value"))
            # 注意：new_value 可能是 0/""/False 等 falsy 值，需要用 is not None 判断
            if field_name and new_value is not None:
                self._index_manager.update_entity_current(entity_id, {field_name: new_value})

        # 4. 处理新关系
        for rel in relationships_new:
            from_entity = rel.get("from", rel.get("from_entity"))
            to_entity = rel.get("to", rel.get("to_entity"))
            if not from_entity or not to_entity:
                continue

            self.upsert_relationship(
                from_entity=from_entity,
                to_entity=to_entity,
                type=rel.get("type", "相识"),
                description=rel.get("description", ""),
                chapter=chapter
            )
            stats["relationships"] += 1

        return stats

    def _update_last_appearance(self, entity_id: str, chapter: int):
        """更新实体的 last_appearance"""
        with self._index_manager._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE entities SET
                    last_appearance = MAX(last_appearance, ?),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (chapter, entity_id))
            conn.commit()

    # ==================== 统计 ====================

    def get_stats(self) -> Dict[str, int]:
        """获取统计信息"""
        return self._index_manager.get_stats()

    # ==================== 格式转换（兼容性） ====================

    def export_to_entities_v3_format(self) -> Dict[str, Dict[str, Dict]]:
        """
        导出为 entities_v3 格式（用于兼容性）

        返回: {"角色": {"xiaoyan": {...}}, "地点": {...}, ...}
        """
        result = {t: {} for t in self.ENTITY_TYPES}

        for entity_type in self.ENTITY_TYPES:
            entities = self.get_entities_by_type(entity_type, include_archived=True)
            for e in entities:
                entity_dict = {
                    "canonical_name": e.get("canonical_name"),
                    "name": e.get("canonical_name"),  # 兼容性别名
                    "tier": e.get("tier", "装饰"),
                    "aliases": e.get("aliases", []),
                    "desc": e.get("desc", ""),
                    "current": e.get("current_json", {}),
                    "history": [],  # 历史记录需要从 state_changes 表查询
                    "first_appearance": e.get("first_appearance", 0),
                    "last_appearance": e.get("last_appearance", 0)
                }
                if e.get("is_protagonist"):
                    entity_dict["is_protagonist"] = True
                result[entity_type][e["id"]] = entity_dict

        return result

    def export_to_alias_index_format(self) -> Dict[str, List[Dict[str, str]]]:
        """
        导出为 alias_index 格式（用于兼容性）

        返回: {"萧炎": [{"type": "角色", "id": "xiaoyan"}], ...}
        """
        result = {}

        with self._index_manager._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT alias, entity_id, entity_type FROM aliases")
            for row in cursor.fetchall():
                alias = row["alias"]
                if alias not in result:
                    result[alias] = []
                result[alias].append({
                    "type": row["entity_type"],
                    "id": row["entity_id"]
                })

        return result


# ==================== CLI 接口 ====================

def main():
    import argparse
    from .cli_output import print_success, print_error
    from .index_manager import IndexManager

    parser = argparse.ArgumentParser(description="SQL State Manager CLI (v5.4)")
    parser.add_argument("--project-root", type=str, help="项目根目录")

    subparsers = parser.add_subparsers(dest="command")

    # 获取统计
    subparsers.add_parser("stats")

    # 获取主角
    subparsers.add_parser("get-protagonist")

    # 获取核心实体
    subparsers.add_parser("get-core-entities")

    # 导出 entities_v3 格式
    subparsers.add_parser("export-entities-v3")

    # 导出 alias_index 格式
    subparsers.add_parser("export-alias-index")

    # 处理章节数据
    process_parser = subparsers.add_parser("process-chapter")
    process_parser.add_argument("--chapter", type=int, required=True)
    process_parser.add_argument("--data", required=True, help="JSON 格式的章节数据")

    args = parser.parse_args()

    # 初始化
    config = None
    if args.project_root:
        from .config import DataModulesConfig
        config = DataModulesConfig.from_project_root(args.project_root)

    manager = SQLStateManager(config)
    logger = IndexManager(config)
    tool_name = f"sql_state_manager:{args.command or 'unknown'}"

    def emit_success(data=None, message: str = "ok"):
        print_success(data, message=message)
        try:
            logger.log_tool_call(tool_name, True)
        except Exception:
            pass

    def emit_error(code: str, message: str, suggestion: str | None = None):
        print_error(code, message, suggestion=suggestion)
        try:
            logger.log_tool_call(tool_name, False, error_code=code, error_message=message)
        except Exception:
            pass

    if args.command == "stats":
        stats = manager.get_stats()
        emit_success(stats, message="stats")

    elif args.command == "get-protagonist":
        protagonist = manager.get_protagonist()
        if protagonist:
            emit_success(protagonist, message="protagonist")
        else:
            emit_error("NOT_FOUND", "未设置主角")

    elif args.command == "get-core-entities":
        entities = manager.get_core_entities()
        emit_success(entities, message="core_entities")

    elif args.command == "export-entities-v3":
        data = manager.export_to_entities_v3_format()
        emit_success(data, message="entities_v3")

    elif args.command == "export-alias-index":
        data = manager.export_to_alias_index_format()
        emit_success(data, message="alias_index")

    elif args.command == "process-chapter":
        data = json.loads(args.data)
        stats = manager.process_chapter_entities(
            chapter=args.chapter,
            entities_appeared=data.get("entities_appeared", []),
            entities_new=data.get("entities_new", []),
            state_changes=data.get("state_changes", []),
            relationships_new=data.get("relationships_new", []),
        )
        emit_success(stats, message="chapter_processed")

    else:
        emit_error("UNKNOWN_COMMAND", "未指定有效命令", suggestion="请查看 --help")


if __name__ == "__main__":
    main()
