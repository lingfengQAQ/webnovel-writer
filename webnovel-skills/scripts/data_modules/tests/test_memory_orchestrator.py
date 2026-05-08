#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from data_modules.config import DataModulesConfig
from data_modules.memory.orchestrator import MemoryOrchestrator
from data_modules.memory.schema import MemoryItem
from data_modules.memory.store import ScratchpadManager


def _cfg(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    cfg.ensure_dirs()
    return cfg


def test_build_memory_pack_empty(tmp_path):
    orchestrator = MemoryOrchestrator(_cfg(tmp_path))
    pack = orchestrator.build_memory_pack(1)
    assert pack["stats"]["total"] == 0
    assert pack["semantic_memory"] == []
    assert pack["long_term_facts"] == pack["semantic_memory"]
    assert len(pack["long_term_facts"]) == pack["stats"]["injected"]
    assert "working_memory" in pack
    assert "episodic_memory" in pack
    assert "semantic_memory" in pack


def test_build_memory_pack_filter_and_budget(tmp_path):
    cfg = _cfg(tmp_path)
    cfg.memory_orchestrator_max_items = 1
    outline_dir = cfg.project_root / "大纲"
    outline_dir.mkdir(parents=True, exist_ok=True)
    (outline_dir / "第1卷 详细大纲.md").write_text("### 第10章：萧炎突破\n", encoding="utf-8")

    store = ScratchpadManager(cfg)
    store.upsert_item(
        MemoryItem(
            id="m1",
            layer="semantic",
            category="character_state",
            subject="萧炎",
            field="realm",
            value="斗师",
            source_chapter=9,
        )
    )
    store.upsert_item(
        MemoryItem(
            id="m2",
            layer="semantic",
            category="story_fact",
            subject="chapter_hook",
            field="9",
            value="神秘强者出现",
            source_chapter=9,
        )
    )

    orchestrator = MemoryOrchestrator(cfg)
    pack = orchestrator.build_memory_pack(10)
    assert pack["stats"]["total"] >= 2
    assert len(pack["long_term_facts"]) == 1
    assert pack["stats"]["semantic_total"] >= 1
    assert pack["long_term_facts"] == pack["semantic_memory"]
