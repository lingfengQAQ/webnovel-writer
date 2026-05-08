#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""记忆契约类型与 Protocol 测试。"""
from __future__ import annotations

from dataclasses import asdict

import pytest

from data_modules.memory_contract import (
    CommitResult,
    ContextPack,
    EntitySnapshot,
    MemoryContract,
    OpenLoop,
    Rule,
    TimelineEvent,
)


# ---------------------------------------------------------------------------
# 类型实例化 + 序列化
# ---------------------------------------------------------------------------

class TestContractTypes:
    def test_commit_result_defaults(self):
        r = CommitResult(chapter=10)
        assert r.chapter == 10
        assert r.entities_added == 0
        assert r.warnings == []

    def test_commit_result_to_dict(self):
        r = CommitResult(chapter=5, entities_added=3, warnings=["w1"])
        d = r.to_dict()
        assert d["chapter"] == 5
        assert d["entities_added"] == 3
        assert d["warnings"] == ["w1"]

    def test_entity_snapshot_roundtrip(self):
        e = EntitySnapshot(
            id="xiaoyan", name="萧炎", type="角色", tier="核心",
            aliases=["他"], attributes={"realm": "斗帝"},
            first_appearance=1, last_appearance=100,
            recent_state_changes=[{"field": "realm", "old": "斗圣", "new": "斗帝"}],
        )
        d = e.to_dict()
        assert d["id"] == "xiaoyan"
        assert d["aliases"] == ["他"]
        assert len(d["recent_state_changes"]) == 1

    def test_rule_to_dict(self):
        r = Rule(id="r1", subject="异火", field="数量", value="23种", domain="力量体系", source_chapter=1)
        d = r.to_dict()
        assert d["domain"] == "力量体系"

    def test_open_loop_defaults(self):
        o = OpenLoop(id="ol1", content="三年之约")
        assert o.status == "active"
        assert o.urgency == 0.0

    def test_timeline_event_to_dict(self):
        t = TimelineEvent(event="萧炎突破斗帝", chapter=1500, time_hint="大结局", event_type="突破")
        d = t.to_dict()
        assert d["chapter"] == 1500

    def test_context_pack_defaults(self):
        c = ContextPack(chapter=10)
        assert c.sections == {}
        assert c.budget_used_tokens == 0

    def test_context_pack_with_sections(self):
        c = ContextPack(chapter=10, sections={"task_book": {"goal": "test"}}, budget_used_tokens=1500)
        d = c.to_dict()
        assert d["sections"]["task_book"]["goal"] == "test"
        assert d["budget_used_tokens"] == 1500


# ---------------------------------------------------------------------------
# Protocol 结构检查
# ---------------------------------------------------------------------------

class _FakeMemory:
    """满足 MemoryContract Protocol 的最小实现。"""
    def commit_chapter(self, chapter: int, result: dict) -> CommitResult:
        return CommitResult(chapter=chapter)
    def load_context(self, chapter: int, budget_tokens: int = 4000) -> ContextPack:
        return ContextPack(chapter=chapter)
    def query_entity(self, entity_id: str):
        return None
    def query_rules(self, domain: str = ""):
        return []
    def read_summary(self, chapter: int) -> str:
        return ""
    def get_open_loops(self, status: str = "active"):
        return []
    def get_timeline(self, from_ch: int, to_ch: int):
        return []


class TestProtocol:
    def test_fake_satisfies_protocol(self):
        m = _FakeMemory()
        assert isinstance(m, MemoryContract)

    def test_protocol_methods_callable(self):
        m: MemoryContract = _FakeMemory()
        assert m.commit_chapter(1, {}).chapter == 1
        assert m.load_context(1).chapter == 1
        assert m.query_entity("x") is None
        assert m.query_rules() == []
        assert m.read_summary(1) == ""
        assert m.get_open_loops() == []
        assert m.get_timeline(1, 10) == []
