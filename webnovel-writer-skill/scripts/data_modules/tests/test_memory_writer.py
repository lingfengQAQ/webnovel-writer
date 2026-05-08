#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from data_modules.config import DataModulesConfig
from data_modules.memory.store import ScratchpadManager
from data_modules.memory.writer import MemoryWriter


def _cfg(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    return cfg


def test_writer_stage2_mapping(tmp_path):
    cfg = _cfg(tmp_path)
    writer = MemoryWriter(cfg)
    result = {
        "entities_new": [{"suggested_id": "yaolao", "name": "药老", "type": "角色", "tier": "重要"}],
        "state_changes": [{"entity_id": "xiaoyan", "field": "realm", "old": "斗者", "new": "斗师"}],
        "relationships_new": [{"from": "xiaoyan", "to": "yaolao", "type": "师徒", "description": "收徒"}],
        "chapter_meta": {"hook": {"content": "三年之约将至", "type": "悬念钩", "strength": "strong"}},
    }
    summary = writer.update_from_chapter_result(12, result)
    assert summary["items_added"] >= 4
    store = ScratchpadManager(cfg)
    chars = store.query(category="character_state", status="active")
    assert any(x.subject == "xiaoyan" and x.field == "realm" for x in chars)
    rels = store.query(category="relationship", status="active")
    assert any(x.subject == "xiaoyan" and x.field == "yaolao" for x in rels)


def test_writer_stage4_memory_facts_mapping(tmp_path):
    cfg = _cfg(tmp_path)
    writer = MemoryWriter(cfg)
    result = {
        "memory_facts": {
            "timeline_events": [{"event": "萧炎离开天云宗", "chapter": 100, "time_hint": "三年之约前夕"}],
            "world_rules": [{"rule": "修炼体系九境", "scope": "global", "domain": "修炼体系", "field": "境界划分"}],
            "open_loops": [{"content": "三年之约", "status": "active", "urgency": 80}],
            "reader_promises": [{"content": "纳兰嫣然会出场", "type": "encounter", "target": "纳兰嫣然"}],
        }
    }
    summary = writer.update_from_chapter_result(100, result)
    assert summary["items_added"] >= 4
    store = ScratchpadManager(cfg)
    assert store.query(category="timeline", status="active")
    assert store.query(category="world_rule", status="active")
    assert store.query(category="open_loop", status="active")
    assert store.query(category="reader_promise", status="active")

