#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
migrate_state_to_sqlite.py - 数据迁移脚本 (v5.4)

将 state.json 中的大数据迁移到 SQLite (index.db):
- entities_v3 → entities 表
- alias_index → aliases 表
- state_changes → state_changes 表
- structured_relationships → relationships 表

迁移后 state.json 只保留精简数据 (< 5KB):
- progress
- protagonist_state
- strand_tracker
- disambiguation_warnings/pending
- project_info
- world_settings (骨架)
- plot_threads
- relationships (简化版)
- review_checkpoints

用法:
    python -m data_modules.migrate_state_to_sqlite --project-root "D:/wk/斗破苍穹"
    python -m data_modules.migrate_state_to_sqlite --project-root "." --dry-run
    python -m data_modules.migrate_state_to_sqlite --project-root "." --backup
"""

import json
import shutil
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List

from .config import get_config, DataModulesConfig
from .sql_state_manager import SQLStateManager, EntityData


def migrate_state_to_sqlite(
    config: DataModulesConfig,
    dry_run: bool = False,
    backup: bool = True,
    verbose: bool = True
) -> Dict[str, int]:
    """
    执行迁移

    参数:
    - config: 配置对象
    - dry_run: 只分析不实际写入
    - backup: 迁移前备份 state.json
    - verbose: 打印详细日志

    返回: 迁移统计
    """
    stats = {
        "entities": 0,
        "aliases": 0,
        "state_changes": 0,
        "relationships": 0,
        "skipped": 0,
        "errors": 0
    }

    # 读取 state.json
    state_file = config.state_file
    if not state_file.exists():
        if verbose:
            print(f"❌ state.json 不存在: {state_file}")
        return stats

    with open(state_file, 'r', encoding='utf-8') as f:
        state = json.load(f)

    if verbose:
        file_size = state_file.stat().st_size / 1024
        print(f"📄 读取 state.json ({file_size:.1f} KB)")

    # 备份
    if backup and not dry_run:
        backup_file = state_file.with_suffix(f".json.backup-{datetime.now().strftime('%Y%m%d_%H%M%S')}")
        shutil.copy(state_file, backup_file)
        if verbose:
            print(f"💾 已备份到: {backup_file}")

    # 初始化 SQLStateManager
    sql_manager = SQLStateManager(config)

    # 1. 迁移 entities_v3
    entities_v3 = state.get("entities_v3", {})
    if verbose:
        print(f"\n🔄 迁移 entities_v3...")

    for entity_type, entities in entities_v3.items():
        if not isinstance(entities, dict):
            continue

        for entity_id, entity_data in entities.items():
            if not isinstance(entity_data, dict):
                stats["skipped"] += 1
                continue

            try:
                entity = EntityData(
                    id=entity_id,
                    type=entity_type,
                    name=entity_data.get("canonical_name", entity_data.get("name", entity_id)),
                    tier=entity_data.get("tier", "装饰"),
                    desc=entity_data.get("desc", ""),
                    current=entity_data.get("current", {}),
                    aliases=[],  # 别名单独处理
                    first_appearance=entity_data.get("first_appearance", 0),
                    last_appearance=entity_data.get("last_appearance", 0),
                    is_protagonist=entity_data.get("is_protagonist", False)
                )

                if not dry_run:
                    sql_manager.upsert_entity(entity)
                stats["entities"] += 1

                if verbose and stats["entities"] % 50 == 0:
                    print(f"  已迁移 {stats['entities']} 个实体...")

            except Exception as e:
                stats["errors"] += 1
                if verbose:
                    print(f"  ⚠️ 实体迁移失败 {entity_id}: {e}")

    if verbose:
        print(f"  ✅ 实体: {stats['entities']} 个")

    # 2. 迁移 alias_index
    alias_index = state.get("alias_index", {})
    if verbose:
        print(f"\n🔄 迁移 alias_index...")

    for alias, entries in alias_index.items():
        if not isinstance(entries, list):
            continue

        for entry in entries:
            if not isinstance(entry, dict):
                stats["skipped"] += 1
                continue

            entity_id = entry.get("id")
            entity_type = entry.get("type")
            if not entity_id or not entity_type:
                stats["skipped"] += 1
                continue

            try:
                if not dry_run:
                    sql_manager.register_alias(alias, entity_id, entity_type)
                stats["aliases"] += 1

            except Exception as e:
                stats["errors"] += 1
                if verbose:
                    print(f"  ⚠️ 别名迁移失败 {alias}: {e}")

    if verbose:
        print(f"  ✅ 别名: {stats['aliases']} 个")

    # 3. 迁移 state_changes
    state_changes = state.get("state_changes", [])
    if verbose:
        print(f"\n🔄 迁移 state_changes...")

    for change in state_changes:
        if not isinstance(change, dict):
            stats["skipped"] += 1
            continue

        try:
            entity_id = change.get("entity_id", "")
            if not entity_id:
                stats["skipped"] += 1
                continue

            if not dry_run:
                sql_manager.record_state_change(
                    entity_id=entity_id,
                    field=change.get("field", ""),
                    old_value=change.get("old", change.get("old_value", "")),
                    new_value=change.get("new", change.get("new_value", "")),
                    reason=change.get("reason", ""),
                    chapter=change.get("chapter", 0)
                )
            stats["state_changes"] += 1

        except Exception as e:
            stats["errors"] += 1
            if verbose:
                print(f"  ⚠️ 状态变化迁移失败: {e}")

    if verbose:
        print(f"  ✅ 状态变化: {stats['state_changes']} 条")

    # 4. 迁移 structured_relationships
    relationships = state.get("structured_relationships", [])
    if verbose:
        print(f"\n🔄 迁移 structured_relationships...")

    for rel in relationships:
        if not isinstance(rel, dict):
            stats["skipped"] += 1
            continue

        try:
            from_entity = rel.get("from", rel.get("from_entity", ""))
            to_entity = rel.get("to", rel.get("to_entity", ""))
            if not from_entity or not to_entity:
                stats["skipped"] += 1
                continue

            if not dry_run:
                sql_manager.upsert_relationship(
                    from_entity=from_entity,
                    to_entity=to_entity,
                    type=rel.get("type", "相识"),
                    description=rel.get("description", ""),
                    chapter=rel.get("chapter", 0)
                )
            stats["relationships"] += 1

        except Exception as e:
            stats["errors"] += 1
            if verbose:
                print(f"  ⚠️ 关系迁移失败: {e}")

    if verbose:
        print(f"  ✅ 关系: {stats['relationships']} 条")

    # 5. 精简 state.json（移除已迁移字段）
    if not dry_run:
        if verbose:
            print(f"\n🔄 精简 state.json...")

        # 保留字段
        slim_state = {
            "project_info": state.get("project_info", {}),
            "progress": state.get("progress", {}),
            "protagonist_state": state.get("protagonist_state", {}),
            "strand_tracker": state.get("strand_tracker", {}),
            "world_settings": _slim_world_settings(state.get("world_settings", {})),
            "plot_threads": state.get("plot_threads", {}),
            "relationships": _slim_relationships(state.get("relationships", {})),
            "review_checkpoints": state.get("review_checkpoints", [])[-10:],  # 只保留最近10个
            "disambiguation_warnings": state.get("disambiguation_warnings", [])[-20:],
            "disambiguation_pending": state.get("disambiguation_pending", [])[-10:],
            # v5.1 引入标记
            "_migrated_to_sqlite": True,
            "_migration_timestamp": datetime.now().isoformat()
        }

        with open(state_file, 'w', encoding='utf-8') as f:
            json.dump(slim_state, f, ensure_ascii=False, indent=2)

        new_size = state_file.stat().st_size / 1024
        if verbose:
            print(f"  ✅ 精简后: {new_size:.1f} KB")

    # 打印统计
    if verbose:
        print(f"\n" + "=" * 50)
        print(f"📊 迁移统计:")
        print(f"  实体: {stats['entities']}")
        print(f"  别名: {stats['aliases']}")
        print(f"  状态变化: {stats['state_changes']}")
        print(f"  关系: {stats['relationships']}")
        print(f"  跳过: {stats['skipped']}")
        print(f"  错误: {stats['errors']}")
        if dry_run:
            print(f"\n⚠️ 这是 dry-run 模式，实际未写入任何数据")

    return stats


def _slim_world_settings(world_settings: Dict) -> Dict:
    """精简 world_settings，只保留骨架"""
    if not isinstance(world_settings, dict):
        return {}

    slim = {}

    # power_system: 只保留等级名称
    power_system = world_settings.get("power_system", [])
    if isinstance(power_system, list):
        slim["power_system"] = [
            p.get("name") if isinstance(p, dict) else p
            for p in power_system[:20]  # 最多20个等级
        ]

    # factions: 只保留名称和简述
    factions = world_settings.get("factions", [])
    if isinstance(factions, list):
        slim["factions"] = [
            {"name": f.get("name"), "type": f.get("type")}
            if isinstance(f, dict) else f
            for f in factions[:30]  # 最多30个势力
        ]

    # locations: 只保留名称
    locations = world_settings.get("locations", [])
    if isinstance(locations, list):
        slim["locations"] = [
            loc.get("name") if isinstance(loc, dict) else loc
            for loc in locations[:50]  # 最多50个地点
        ]

    return slim


def _slim_relationships(relationships: Dict) -> Dict:
    """精简 relationships，只保留核心关系"""
    if not isinstance(relationships, dict):
        return {}

    # 只保留 relationships 字典本身，不做额外精简
    # 因为这个字段本身应该比较小
    return relationships


def main():
    import argparse
    from .cli_output import print_success, print_error
    from .index_manager import IndexManager

    parser = argparse.ArgumentParser(description="迁移 state.json 到 SQLite (v5.4)")
    parser.add_argument("--project-root", type=str, required=True, help="项目根目录")
    parser.add_argument("--dry-run", action="store_true", help="只分析不实际写入")
    parser.add_argument("--backup", action="store_true", default=True, help="迁移前备份")
    parser.add_argument("--no-backup", action="store_true", help="不备份")
    parser.add_argument("--quiet", action="store_true", help="安静模式")

    args = parser.parse_args()

    config = DataModulesConfig.from_project_root(args.project_root)
    backup = not args.no_backup
    logger = IndexManager(config)
    tool_name = "migrate_state_to_sqlite"

    try:
        stats = migrate_state_to_sqlite(
            config=config,
            dry_run=args.dry_run,
            backup=backup,
            verbose=False,
        )
    except Exception as exc:
        print_error("MIGRATE_FAILED", str(exc), suggestion="检查 state.json 与 index.db 权限")
        try:
            logger.log_tool_call(tool_name, False, error_code="MIGRATE_FAILED", error_message=str(exc))
        except Exception:
            pass
        raise SystemExit(1)

    if stats.get("errors", 0) > 0:
        print_error("MIGRATE_ERRORS", "迁移出现错误", details=stats)
        try:
            logger.log_tool_call(tool_name, False, error_code="MIGRATE_ERRORS", error_message="迁移出现错误")
        except Exception:
            pass
        raise SystemExit(1)

    print_success({"project": str(config.project_root), **stats}, message="migrated")
    try:
        logger.log_tool_call(tool_name, True)
    except Exception:
        pass


if __name__ == "__main__":
    main()
