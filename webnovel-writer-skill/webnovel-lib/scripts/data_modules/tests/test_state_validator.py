#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from data_modules.state_validator import (
    FORESHADOWING_STATUS_PENDING,
    FORESHADOWING_STATUS_RESOLVED,
    FORESHADOWING_TIER_CORE,
    FORESHADOWING_TIER_DECOR,
    FORESHADOWING_TIER_SUB,
    count_patterns,
    get_chapter_meta_entry,
    is_resolved_foreshadowing_status,
    normalize_chapter_meta,
    normalize_foreshadowing_item,
    normalize_foreshadowing_status,
    normalize_foreshadowing_tier,
    normalize_state_runtime_sections,
    resolve_chapter_field,
    split_patterns,
    to_positive_int,
)


def test_to_positive_int_and_resolve_chapter_field():
    assert to_positive_int(12) == 12
    assert to_positive_int("ch-18") == 18
    assert to_positive_int(0) is None
    assert to_positive_int("no number") is None

    item = {"added_chapter": "第15章", "target": "200"}
    assert resolve_chapter_field(item, ["planted_chapter", "added_chapter"]) == 15
    assert resolve_chapter_field(item, ["target_chapter", "target"]) == 200


def test_status_and_tier_normalization():
    assert normalize_foreshadowing_status("pending") == FORESHADOWING_STATUS_PENDING
    assert normalize_foreshadowing_status("resolved") == FORESHADOWING_STATUS_RESOLVED
    assert normalize_foreshadowing_status("") == FORESHADOWING_STATUS_PENDING
    assert is_resolved_foreshadowing_status("已回收") is True
    assert is_resolved_foreshadowing_status("active") is False

    assert normalize_foreshadowing_tier("core") == FORESHADOWING_TIER_CORE
    assert normalize_foreshadowing_tier("decoration") == FORESHADOWING_TIER_DECOR
    assert normalize_foreshadowing_tier("unknown") == FORESHADOWING_TIER_SUB


def test_pattern_split_and_count():
    assert split_patterns(["A", " A ", "B", ""]) == ["A", "B"]
    assert split_patterns("A, B / C|A") == ["A", "B", "C"]
    assert count_patterns("A,B,C") == 3
    assert count_patterns(123) is None


def test_normalize_foreshadowing_item_and_chapter_meta_entry():
    item = {
        "content": "  遗迹钥匙  ",
        "status": "pending",
        "tier": "main",
        "added_chapter": "第30章",
        "target": "120",
    }
    normalized_item = normalize_foreshadowing_item(item)
    assert normalized_item["content"] == "遗迹钥匙"
    assert normalized_item["status"] == FORESHADOWING_STATUS_PENDING
    assert normalized_item["tier"] == FORESHADOWING_TIER_CORE
    assert normalized_item["planted_chapter"] == 30
    assert normalized_item["target_chapter"] == 120

    state = {
        "chapter_meta": {
            "0003": {"coolpoint_pattern": "反杀, 掉马"},
            "7": {"patterns": ["翻车", "反杀"]},
        }
    }
    meta3 = get_chapter_meta_entry(state, 3)
    assert meta3["coolpoint_patterns"] == ["反杀", "掉马"]

    meta7 = get_chapter_meta_entry(state, 7)
    assert meta7["coolpoint_patterns"] == ["翻车", "反杀"]


def test_normalize_state_runtime_sections():
    state = {
        "plot_threads": {
            "foreshadowing": [
                {"content": "伏笔A", "status": "active", "tier": "decor", "chapter": 11, "target": 99},
                "invalid",
            ]
        },
        "chapter_meta": {
            1: {"cool_point_pattern": "打脸|翻车"},
            "bad": "invalid",
        },
    }

    normalized = normalize_state_runtime_sections(state)
    assert len(normalized["plot_threads"]["foreshadowing"]) == 1
    first = normalized["plot_threads"]["foreshadowing"][0]
    assert first["status"] == FORESHADOWING_STATUS_PENDING
    assert first["tier"] == FORESHADOWING_TIER_DECOR
    assert first["planted_chapter"] == 11
    assert first["target_chapter"] == 99

    chapter_meta = normalize_chapter_meta(normalized["chapter_meta"])
    assert "1" in chapter_meta
    assert chapter_meta["1"]["coolpoint_patterns"] == ["打脸", "翻车"]
