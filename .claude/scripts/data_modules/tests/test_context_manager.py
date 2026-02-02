#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ContextManager and SnapshotManager tests
"""

import json

import pytest

from data_modules.config import DataModulesConfig
from data_modules.index_manager import IndexManager, EntityMeta
from data_modules.context_manager import ContextManager
from data_modules.snapshot_manager import SnapshotManager, SnapshotVersionMismatch
from data_modules.query_router import QueryRouter


@pytest.fixture
def temp_project(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    return cfg


def test_snapshot_manager_roundtrip(temp_project):
    manager = SnapshotManager(temp_project)
    payload = {"hello": "world"}
    manager.save_snapshot(1, payload)
    loaded = manager.load_snapshot(1)
    assert loaded["payload"] == payload


def test_snapshot_version_mismatch(temp_project):
    manager = SnapshotManager(temp_project, version="1.0")
    manager.save_snapshot(1, {"a": 1})
    other = SnapshotManager(temp_project, version="2.0")
    with pytest.raises(SnapshotVersionMismatch):
        other.load_snapshot(1)


def test_context_manager_build_and_filter(temp_project):
    state = {
        "protagonist_state": {"name": "萧炎", "location": {"current": "天云宗"}},
        "chapter_meta": {"0001": {"hook": "测试"}},
    }
    temp_project.state_file.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")

    # preferences and memory
    (temp_project.webnovel_dir / "preferences.json").write_text(json.dumps({"tone": "热血"}, ensure_ascii=False), encoding="utf-8")
    (temp_project.webnovel_dir / "project_memory.json").write_text(json.dumps({"patterns": []}, ensure_ascii=False), encoding="utf-8")

    idx = IndexManager(temp_project)
    idx.upsert_entity(
        EntityMeta(
            id="xiaoyan",
            type="角色",
            canonical_name="萧炎",
            current={},
            first_appearance=1,
            last_appearance=1,
        )
    )
    idx.upsert_entity(
        EntityMeta(
            id="bad",
            type="角色",
            canonical_name="坏人",
            current={},
            first_appearance=1,
            last_appearance=1,
        )
    )
    idx.record_appearance("xiaoyan", 1, ["萧炎"], 1.0)
    idx.record_appearance("bad", 1, ["坏人"], 1.0)
    invalid_id = idx.mark_invalid_fact("entity", "bad", "错误")
    idx.resolve_invalid_fact(invalid_id, "confirm")

    manager = ContextManager(temp_project)
    payload = manager.build_context(1, use_snapshot=False, save_snapshot=False)
    characters = payload["sections"]["scene"]["content"]["appearing_characters"]
    assert any(c.get("entity_id") == "xiaoyan" for c in characters)
    assert not any(c.get("entity_id") == "bad" for c in characters)
    assert payload["sections"]["preferences"]["content"].get("tone") == "热血"


def test_query_router():
    router = QueryRouter()
    assert router.route("角色是谁") == "entity"
    assert router.route("发生了什么剧情") == "plot"
    assert "A" in router.split("A, B；C")
