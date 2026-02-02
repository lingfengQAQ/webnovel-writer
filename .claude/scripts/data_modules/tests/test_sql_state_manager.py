#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SQLStateManager tests
"""

import json
import sys

import pytest

import data_modules.sql_state_manager as sql_state_manager_module
from data_modules.sql_state_manager import SQLStateManager, EntityData
from data_modules.index_manager import EntityMeta


@pytest.fixture
def temp_project(tmp_path):
    from data_modules.config import DataModulesConfig
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    return cfg


def test_sql_state_manager_entity_and_alias(temp_project):
    manager = SQLStateManager(temp_project)
    entity = EntityData(
        id="xiaoyan",
        type="角色",
        name="萧炎",
        tier="核心",
        current={"realm": "斗师"},
        aliases=["炎帝", "小炎子"],
        is_protagonist=True,
    )
    assert manager.upsert_entity(entity) is True
    assert manager.upsert_entity(entity) is False

    fetched = manager.get_entity("xiaoyan")
    assert "炎帝" in fetched["aliases"]

    by_type = manager.get_entities_by_type("角色")
    assert any(e["id"] == "xiaoyan" for e in by_type)

    core = manager.get_core_entities()
    assert any(e["id"] == "xiaoyan" for e in core)

    protagonist = manager.get_protagonist()
    assert protagonist["id"] == "xiaoyan"

    resolved = manager.resolve_alias("炎帝")
    assert any(r["id"] == "xiaoyan" for r in resolved)

    assert manager.update_entity_current("xiaoyan", {"realm": "斗王"}) is True
    updated = manager.get_entity("xiaoyan")
    assert updated["current_json"]["realm"] == "斗王"


def test_sql_state_manager_state_changes_and_relationships(temp_project):
    manager = SQLStateManager(temp_project)
    manager.upsert_entity(
        EntityData(id="xiaoyan", type="角色", name="萧炎", current={})
    )
    change_id = manager.record_state_change(
        entity_id="xiaoyan",
        field="realm",
        old_value="斗者",
        new_value="斗师",
        reason="突破",
        chapter=2,
    )
    assert change_id > 0
    assert len(manager.get_entity_state_changes("xiaoyan")) == 1
    assert len(manager.get_recent_state_changes(limit=5)) == 1
    assert len(manager.get_chapter_state_changes(2)) == 1

    assert manager.upsert_relationship(
        from_entity="xiaoyan",
        to_entity="yaolao",
        type="师徒",
        description="收徒",
        chapter=1,
    )
    rels = manager.get_entity_relationships("xiaoyan", direction="from")
    assert len(rels) == 1
    between = manager.get_relationship_between("xiaoyan", "yaolao")
    assert len(between) == 1
    assert len(manager.get_recent_relationships(limit=5)) >= 1


def test_sql_state_manager_process_chapter_entities_and_exports(temp_project):
    manager = SQLStateManager(temp_project)
    stats = manager.process_chapter_entities(
        chapter=10,
        entities_appeared=[{"id": "xiaoyan", "mentions": ["萧炎"], "confidence": 0.9}],
        entities_new=[
            {"suggested_id": "yaolao", "name": "药老", "type": "角色", "tier": "重要"}
        ],
        state_changes=[
            {"entity_id": "yaolao", "field": "status", "old": "", "new": "出场", "reason": "登场"}
        ],
        relationships_new=[
            {"from": "xiaoyan", "to": "yaolao", "type": "师徒", "description": "收徒"}
        ],
    )
    assert stats["entities_created"] >= 1
    assert stats["relationships"] == 1

    entities_v3 = manager.export_to_entities_v3_format()
    assert "角色" in entities_v3

    alias_index = manager.export_to_alias_index_format()
    assert isinstance(alias_index, dict)


def test_sql_state_manager_existing_entity_updates_and_stats(temp_project):
    manager = SQLStateManager(temp_project)
    manager.upsert_entity(
        EntityData(id="xiaoyan", type="角色", name="萧炎", current={"hp": 5})
    )

    stats = manager.process_chapter_entities(
        chapter=3,
        entities_appeared=[{"id": "xiaoyan", "mentions": ["萧炎"], "confidence": 0.9}],
        entities_new=[],
        state_changes=[
            {"entity_id": "xiaoyan", "field": "hp", "old": 5, "new": 0, "reason": "受伤"}
        ],
        relationships_new=[
            {"from_entity": "xiaoyan", "to_entity": "yaolao", "type": "师徒", "description": "收徒"}
        ],
    )
    assert stats["entities_updated"] >= 1
    assert stats["state_changes"] == 1

    updated = manager.get_entity("xiaoyan")
    assert updated["current_json"]["hp"] == 0

    rels = manager.get_entity_relationships("yaolao", direction="to")
    assert rels

    stats_summary = manager.get_stats()
    assert "entities" in stats_summary

    exported = manager.export_to_entities_v3_format()
    assert exported["角色"]["xiaoyan"]["canonical_name"] == "萧炎"


def test_sql_state_manager_process_chapter_skips_and_existing(temp_project):
    manager = SQLStateManager(temp_project)
    manager.upsert_entity(EntityData(id="xiaoyan", type="角色", name="萧炎"))

    stats = manager.process_chapter_entities(
        chapter=1,
        entities_appeared=[{"mentions": ["无ID"]}, {"id": "xiaoyan", "mentions": ["萧炎"]}],
        entities_new=[{"name": "无ID"}, {"suggested_id": "xiaoyan", "name": "萧炎"}],
        state_changes=[{"field": "realm"}, {"entity_id": "xiaoyan", "field": "hp", "old": 1, "new": 1}],
        relationships_new=[{"from": "xiaoyan", "to": ""}],
    )
    assert stats["entities_updated"] >= 1
    assert stats["relationships"] == 0


def test_sql_state_manager_export_protagonist_and_cli(temp_project, monkeypatch, capsys):
    manager = SQLStateManager(temp_project)

    def run_cli(args):
        monkeypatch.setattr(sys, "argv", args)
        sql_state_manager_module.main()
        return capsys.readouterr().out

    out = run_cli(["sql_state_manager", "--project-root", str(temp_project.project_root), "get-protagonist"])
    assert "未设置主角" in out

    manager.upsert_entity(
        EntityData(id="xiaoyan", type="角色", name="萧炎", is_protagonist=True)
    )
    exported = manager.export_to_entities_v3_format()
    assert exported["角色"]["xiaoyan"]["is_protagonist"] is True

    out = run_cli(["sql_state_manager", "--project-root", str(temp_project.project_root), "get-protagonist"])
    assert "萧炎" in out

    out = run_cli(["sql_state_manager", "--project-root", str(temp_project.project_root), "stats"])
    assert "entities" in out

    out = run_cli(["sql_state_manager", "--project-root", str(temp_project.project_root), "get-core-entities"])
    assert "萧炎" in out

    out = run_cli(["sql_state_manager", "--project-root", str(temp_project.project_root), "export-entities-v3"])
    assert "角色" in out

    out = run_cli(["sql_state_manager", "--project-root", str(temp_project.project_root), "export-alias-index"])
    assert isinstance(json.loads(out or "{}"), dict)

    payload = json.dumps({"entities_appeared": [], "entities_new": [], "state_changes": [], "relationships_new": []})
    out = run_cli([
        "sql_state_manager",
        "--project-root",
        str(temp_project.project_root),
        "process-chapter",
        "--chapter",
        "2",
        "--data",
        payload,
    ])
    assert "已处理第 2 章" in out
