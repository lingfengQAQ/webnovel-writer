#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from data_modules.config import DataModulesConfig
from data_modules.context_ranker import ContextRanker


def test_rank_recent_summaries_prefers_recency_and_hook(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    ranker = ContextRanker(cfg)

    items = [
        {"chapter": 8, "summary": "平稳推进"},
        {"chapter": 9, "summary": "最后留下悬念？"},
        {"chapter": 7, "summary": "老信息"},
    ]

    ranked = ranker.rank_recent_summaries(items, current_chapter=10)
    assert ranked[0]["chapter"] == 9
    assert ranked[-1]["chapter"] == 7


def test_rank_appearances_uses_recency_and_frequency(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    ranker = ContextRanker(cfg)

    items = [
        {"entity_id": "a", "last_chapter": 9, "total": 1},
        {"entity_id": "b", "last_chapter": 8, "total": 8},
        {"entity_id": "c", "last_chapter": 9, "total": 3},
    ]

    ranked = ranker.rank_appearances(items, current_chapter=10)
    ids = [item["entity_id"] for item in ranked]
    assert ids[0] == "c"
    assert ids[-1] in {"a", "b"}


def test_rank_pack_adds_context_contract_meta(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    ranker = ContextRanker(cfg)

    pack = {
        "meta": {"chapter": 12},
        "core": {"recent_summaries": [{"chapter": 11, "summary": "x"}], "recent_meta": []},
        "scene": {"appearing_characters": []},
        "global": {},
        "story_skeleton": [],
        "alerts": {"disambiguation_warnings": [], "disambiguation_pending": []},
    }

    ranked = ranker.rank_pack(pack, chapter=12)
    assert ranked["meta"]["context_contract_version"] == "v2"
    assert ranked["meta"]["ranker"]["enabled"] is True

