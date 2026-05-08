#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MemoryContractAdapter 集成测试。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# 确保 scripts/ 在 sys.path 中
_scripts_dir = str(Path(__file__).resolve().parent.parent.parent)
if _scripts_dir not in sys.path:
    sys.path.insert(0, _scripts_dir)

from data_modules.config import DataModulesConfig
from data_modules.memory_contract import (
    CommitResult,
    ContextPack,
    EntitySnapshot,
    MemoryContract,
    OpenLoop,
    Rule,
    TimelineEvent,
)
from data_modules.memory_contract_adapter import MemoryContractAdapter


def _make_project(tmp_path: Path) -> DataModulesConfig:
    """创建最小项目结构并返回配置。"""
    webnovel_dir = tmp_path / ".webnovel"
    webnovel_dir.mkdir(parents=True, exist_ok=True)
    (webnovel_dir / "state.json").write_text("{}", encoding="utf-8")
    (webnovel_dir / "summaries").mkdir(exist_ok=True)
    return DataModulesConfig.from_project_root(tmp_path)


class TestAdapterSatisfiesProtocol:
    def test_isinstance_check(self, tmp_path):
        cfg = _make_project(tmp_path)
        adapter = MemoryContractAdapter(cfg)
        assert isinstance(adapter, MemoryContract)


class TestReadSummary:
    def test_read_existing_summary(self, tmp_path):
        cfg = _make_project(tmp_path)
        summary_dir = cfg.webnovel_dir / "summaries"
        summary_dir.mkdir(parents=True, exist_ok=True)
        (summary_dir / "ch0010.md").write_text("第10章摘要", encoding="utf-8")

        adapter = MemoryContractAdapter(cfg)
        text = adapter.read_summary(10)
        assert text == "第10章摘要"

    def test_read_missing_summary(self, tmp_path):
        cfg = _make_project(tmp_path)
        adapter = MemoryContractAdapter(cfg)
        assert adapter.read_summary(999) == ""


class TestQueryEntity:
    def test_query_nonexistent_entity(self, tmp_path):
        cfg = _make_project(tmp_path)
        adapter = MemoryContractAdapter(cfg)
        assert adapter.query_entity("nobody") is None

    def test_query_existing_entity(self, tmp_path):
        cfg = _make_project(tmp_path)
        # 写入包含实体的 state.json
        state = {
            "entities_v3": {
                "角色": {
                    "xiaoyan": {
                        "name": "萧炎",
                        "tier": "核心",
                        "aliases": ["他"],
                        "realm": "斗帝",
                        "first_appearance": 1,
                        "last_appearance": 100,
                    }
                }
            },
            "state_changes": [
                {"entity_id": "xiaoyan", "field": "realm", "old": "斗圣", "new": "斗帝", "chapter": 100}
            ],
        }
        (cfg.state_file).write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")

        adapter = MemoryContractAdapter(cfg)
        snap = adapter.query_entity("xiaoyan")
        assert snap is not None
        assert snap.name == "萧炎"
        assert snap.type == "角色"
        assert snap.tier == "核心"
        assert "他" in snap.aliases
        assert len(snap.recent_state_changes) == 1


class TestQueryRules:
    def test_query_rules_empty(self, tmp_path):
        cfg = _make_project(tmp_path)
        adapter = MemoryContractAdapter(cfg)
        assert adapter.query_rules() == []

    def test_query_rules_with_data(self, tmp_path):
        cfg = _make_project(tmp_path)
        # 写入 scratchpad 数据
        from data_modules.memory.schema import MemoryItem
        from data_modules.memory.store import ScratchpadManager

        store = ScratchpadManager(cfg)
        store.upsert_item(MemoryItem(
            id="rule-1", layer="semantic", category="world_rule",
            subject="力量体系", field="异火数量", value="23种",
            status="active", source_chapter=1,
        ))

        adapter = MemoryContractAdapter(cfg)
        rules = adapter.query_rules()
        assert len(rules) == 1
        assert rules[0].value == "23种"
        assert rules[0].domain == "力量体系"

    def test_query_rules_filter_by_domain(self, tmp_path):
        cfg = _make_project(tmp_path)
        from data_modules.memory.schema import MemoryItem
        from data_modules.memory.store import ScratchpadManager

        store = ScratchpadManager(cfg)
        store.upsert_item(MemoryItem(
            id="rule-1", layer="semantic", category="world_rule",
            subject="力量体系", field="异火数量", value="23种",
            status="active", source_chapter=1,
        ))
        store.upsert_item(MemoryItem(
            id="rule-2", layer="semantic", category="world_rule",
            subject="社会结构", field="帝国数量", value="4个",
            status="active", source_chapter=2,
        ))

        adapter = MemoryContractAdapter(cfg)
        rules = adapter.query_rules(domain="力量体系")
        assert len(rules) == 1
        assert rules[0].field == "异火数量"


class TestGetOpenLoops:
    def test_get_open_loops_empty(self, tmp_path):
        cfg = _make_project(tmp_path)
        adapter = MemoryContractAdapter(cfg)
        assert adapter.get_open_loops() == []

    def test_get_open_loops_with_data(self, tmp_path):
        cfg = _make_project(tmp_path)
        from data_modules.memory.schema import MemoryItem
        from data_modules.memory.store import ScratchpadManager

        store = ScratchpadManager(cfg)
        store.upsert_item(MemoryItem(
            id="ol-1", layer="semantic", category="open_loop",
            subject="三年之约", field="", value="萧炎与纳兰嫣然三年之约",
            status="active", source_chapter=1,
            payload={"expected_payoff": "大比", "urgency": 0.9},
        ))

        adapter = MemoryContractAdapter(cfg)
        loops = adapter.get_open_loops()
        assert len(loops) == 1
        assert loops[0].content == "萧炎与纳兰嫣然三年之约"
        assert loops[0].urgency == 0.9


class TestGetTimeline:
    def test_get_timeline_empty(self, tmp_path):
        cfg = _make_project(tmp_path)
        adapter = MemoryContractAdapter(cfg)
        assert adapter.get_timeline(1, 100) == []

    def test_get_timeline_filters_by_range(self, tmp_path):
        cfg = _make_project(tmp_path)
        from data_modules.memory.schema import MemoryItem
        from data_modules.memory.store import ScratchpadManager

        store = ScratchpadManager(cfg)
        for ch in [5, 10, 50, 100]:
            store.upsert_item(MemoryItem(
                id=f"tl-{ch}", layer="semantic", category="timeline",
                subject="事件", field=f"第{ch}章时", value=f"事件{ch}",
                status="active", source_chapter=ch,
            ))

        adapter = MemoryContractAdapter(cfg)
        events = adapter.get_timeline(8, 55)
        assert len(events) == 2
        assert events[0].chapter == 10
        assert events[1].chapter == 50


class TestLoadContext:
    def test_load_context_returns_context_pack(self, tmp_path):
        cfg = _make_project(tmp_path)
        adapter = MemoryContractAdapter(cfg)
        pack = adapter.load_context(10)
        assert isinstance(pack, ContextPack)
        assert pack.chapter == 10

    def test_load_context_includes_protagonist(self, tmp_path):
        cfg = _make_project(tmp_path)
        state = {
            "progress": {"current_chapter": 9},
            "protagonist_state": {"location": "迦南学院", "power": {"realm": "斗师"}},
        }
        cfg.state_file.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")

        adapter = MemoryContractAdapter(cfg)
        pack = adapter.load_context(10)
        assert "protagonist" in pack.sections
        assert pack.sections["protagonist"]["location"] == "迦南学院"
        assert "progress" in pack.sections

    def test_load_context_includes_recent_summaries(self, tmp_path):
        cfg = _make_project(tmp_path)
        summary_dir = cfg.webnovel_dir / "summaries"
        summary_dir.mkdir(parents=True, exist_ok=True)
        (summary_dir / "ch0008.md").write_text("第8章摘要内容", encoding="utf-8")
        (summary_dir / "ch0009.md").write_text("第9章摘要内容", encoding="utf-8")

        adapter = MemoryContractAdapter(cfg)
        pack = adapter.load_context(10)
        assert "recent_summaries" in pack.sections
        assert "ch0008" in pack.sections["recent_summaries"]
        assert "ch0009" in pack.sections["recent_summaries"]

    def test_load_context_includes_rules_and_loops(self, tmp_path):
        cfg = _make_project(tmp_path)
        from data_modules.memory.schema import MemoryItem
        from data_modules.memory.store import ScratchpadManager

        store = ScratchpadManager(cfg)
        store.upsert_item(MemoryItem(
            id="rule-1", layer="semantic", category="world_rule",
            subject="力量体系", field="异火", value="23种",
            status="active", source_chapter=1,
        ))
        store.upsert_item(MemoryItem(
            id="ol-1", layer="semantic", category="open_loop",
            subject="三年之约", field="", value="萧炎与纳兰嫣然三年之约",
            status="active", source_chapter=1,
        ))

        adapter = MemoryContractAdapter(cfg)
        pack = adapter.load_context(10)
        assert "active_rules" in pack.sections
        assert len(pack.sections["active_rules"]) == 1
        assert "urgent_loops" in pack.sections
        assert len(pack.sections["urgent_loops"]) == 1

    def test_load_context_includes_story_runtime_sections(self, tmp_path):
        cfg = _make_project(tmp_path)
        story_root = tmp_path / ".story-system"
        (story_root / "chapters").mkdir(parents=True, exist_ok=True)
        (story_root / "volumes").mkdir(parents=True, exist_ok=True)
        (story_root / "reviews").mkdir(parents=True, exist_ok=True)
        (story_root / "commits").mkdir(parents=True, exist_ok=True)

        (story_root / "MASTER_SETTING.json").write_text(
            json.dumps(
                {
                    "meta": {"contract_type": "MASTER_SETTING"},
                    "route": {"primary_genre": "玄幻"},
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (story_root / "volumes" / "volume_001.json").write_text(
            json.dumps({"meta": {"contract_type": "VOLUME_BRIEF"}}, ensure_ascii=False),
            encoding="utf-8",
        )
        (story_root / "chapters" / "chapter_003.json").write_text(
            json.dumps({"meta": {"contract_type": "CHAPTER_BRIEF", "chapter": 3}}, ensure_ascii=False),
            encoding="utf-8",
        )
        (story_root / "reviews" / "chapter_003.review.json").write_text(
            json.dumps({"meta": {"contract_type": "REVIEW_CONTRACT", "chapter": 3}}, ensure_ascii=False),
            encoding="utf-8",
        )
        (story_root / "commits" / "chapter_003.commit.json").write_text(
            json.dumps(
                {
                    "meta": {"chapter": 3, "status": "accepted"},
                    "provenance": {"write_fact_role": "chapter_commit"},
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        adapter = MemoryContractAdapter(cfg)
        pack = adapter.load_context(3)

        assert pack.sections["story_contracts"]["master"]["route"]["primary_genre"] == "玄幻"
        assert pack.sections["runtime_status"]["primary_write_source"] == "chapter_commit"
        assert pack.sections["latest_commit"]["meta"]["status"] == "accepted"

    def test_load_context_prefers_actual_latest_commit_status(self, tmp_path):
        cfg = _make_project(tmp_path)
        story_root = tmp_path / ".story-system"
        (story_root / "chapters").mkdir(parents=True, exist_ok=True)
        (story_root / "reviews").mkdir(parents=True, exist_ok=True)
        (story_root / "commits").mkdir(parents=True, exist_ok=True)
        (story_root / "MASTER_SETTING.json").write_text(
            json.dumps({"meta": {"contract_type": "MASTER_SETTING"}}, ensure_ascii=False),
            encoding="utf-8",
        )
        (story_root / "chapters" / "chapter_003.json").write_text(
            json.dumps({"meta": {"contract_type": "CHAPTER_BRIEF", "chapter": 3}}, ensure_ascii=False),
            encoding="utf-8",
        )
        (story_root / "reviews" / "chapter_003.review.json").write_text(
            json.dumps({"meta": {"contract_type": "REVIEW_CONTRACT", "chapter": 3}}, ensure_ascii=False),
            encoding="utf-8",
        )
        (story_root / "commits" / "chapter_002.commit.json").write_text(
            json.dumps({"meta": {"chapter": 2, "status": "accepted"}}, ensure_ascii=False),
            encoding="utf-8",
        )
        (story_root / "commits" / "chapter_003.commit.json").write_text(
            json.dumps({"meta": {"chapter": 3, "status": "rejected"}}, ensure_ascii=False),
            encoding="utf-8",
        )

        adapter = MemoryContractAdapter(cfg)
        pack = adapter.load_context(3)

        assert pack.sections["latest_commit"]["meta"]["status"] == "rejected"
        assert pack.sections["runtime_status"]["latest_accepted_commit"]["meta"]["status"] == "accepted"


class TestCommitChapter:
    def test_commit_chapter_basic(self, tmp_path):
        cfg = _make_project(tmp_path)
        adapter = MemoryContractAdapter(cfg)
        result = adapter.commit_chapter(1, {
            "entities_appeared": [{"id": "xiaoyan", "type": "角色"}],
            "entities_new": [],
            "state_changes": [],
            "relationships_new": [],
        })
        assert isinstance(result, CommitResult)
        assert result.chapter == 1
        assert result.entities_updated == 1

    def test_commit_chapter_delegates_to_chapter_commit_mainline(self, tmp_path):
        cfg = _make_project(tmp_path)
        adapter = MemoryContractAdapter(cfg)

        result = adapter.commit_chapter(
            3,
            {
                "review_result": {"blocking_count": 0},
                "fulfillment_result": {
                    "planned_nodes": ["发现陷阱"],
                    "covered_nodes": ["发现陷阱"],
                    "missed_nodes": [],
                    "extra_nodes": [],
                },
                "disambiguation_result": {"pending": []},
                "extraction_result": {
                    "state_deltas": [],
                    "entity_deltas": [],
                    "accepted_events": [],
                    "summary_text": "本章摘要",
                },
            },
        )

        assert (tmp_path / ".story-system" / "commits" / "chapter_003.commit.json").is_file()
        assert result.chapter == 3
        assert "commit_status=accepted" in result.warnings
