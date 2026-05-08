#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from data_modules.config import DataModulesConfig
from data_modules.index_manager import EntityMeta, RelationshipMeta, StateChangeMeta, IndexManager
from data_modules.memory.bootstrap import bootstrap_from_index
from data_modules.memory.store import ScratchpadManager


def _cfg(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    return cfg


def test_bootstrap_from_index_includes_state_changes_and_open_loops(tmp_path):
    cfg = _cfg(tmp_path)
    idx = IndexManager(cfg)
    idx.upsert_entity(
        EntityMeta(
            id="xiaoyan",
            type="角色",
            canonical_name="萧炎",
            current={"realm": "斗者"},
            first_appearance=1,
            last_appearance=2,
        )
    )
    idx.record_state_change(
        StateChangeMeta(
            entity_id="xiaoyan",
            field="realm",
            old_value="斗者",
            new_value="斗师",
            reason="突破",
            chapter=3,
        )
    )
    idx.record_state_change(
        StateChangeMeta(
            entity_id="xiaoyan",
            field="realm",
            old_value="斗师",
            new_value="大斗师",
            reason="再突破",
            chapter=8,
        )
    )
    idx.upsert_relationship(
        RelationshipMeta(
            from_entity="xiaoyan",
            to_entity="yaolao",
            type="师徒",
            description="授艺",
            chapter=2,
        )
    )

    summaries_dir = cfg.webnovel_dir / "summaries"
    summaries_dir.mkdir(parents=True, exist_ok=True)
    (summaries_dir / "ch0008.md").write_text(
        "## 剧情摘要\n内容\n\n## 伏笔\n- 三年之约\n- 神秘玉佩的来历\n",
        encoding="utf-8",
    )

    result = bootstrap_from_index(cfg)
    assert result["items_created"] > 0
    assert result["categories"].get("character_state", 0) >= 2
    assert result["categories"].get("open_loop", 0) >= 2

    store = ScratchpadManager(cfg)
    active_realm = store.query(category="character_state", subject="xiaoyan", status="active")
    assert any(item.field == "realm" and item.value == "大斗师" for item in active_realm)
    outdated_realm = store.query(category="character_state", subject="xiaoyan", status="outdated")
    assert any(item.field == "realm" and item.value == "斗师" for item in outdated_realm)
    loops = store.query(category="open_loop", status="active")
    assert any("三年之约" in item.value for item in loops)

