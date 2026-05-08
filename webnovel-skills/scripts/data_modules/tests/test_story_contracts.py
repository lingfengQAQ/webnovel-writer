#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json

import pytest

from data_modules.story_contracts import (
    StoryContractPaths,
    merge_anti_patterns,
    merge_contract_layers,
    read_json_if_exists,
)


def test_story_contract_paths_resolve_expected_locations(tmp_path):
    paths = StoryContractPaths.from_project_root(tmp_path)

    assert paths.root == tmp_path.resolve() / ".story-system"
    assert paths.master_json == paths.root / "MASTER_SETTING.json"
    assert paths.anti_patterns_json == paths.root / "anti_patterns.json"
    assert paths.chapter_json(7) == paths.root / "chapters" / "chapter_007.json"


def test_merge_contract_layers_preserves_locked_and_merges_append_only():
    merged = merge_contract_layers(
        {
            "locked": {"core_tone": "先压后爆"},
            "append_only": {"anti_patterns": ["配角连续抢戏超过 300 字"]},
            "override_allowed": {"scene_focus": "退婚当场反杀"},
        },
        {
            "append_only": {"anti_patterns": ["本章禁止解释性旁白"]},
            "override_allowed": {"chapter_focus": "退婚当场反杀"},
        },
    )

    assert merged["locked"]["core_tone"] == "先压后爆"
    assert merged["append_only"]["anti_patterns"] == [
        "配角连续抢戏超过 300 字",
        "本章禁止解释性旁白",
    ]
    assert merged["override_allowed"]["scene_focus"] == "退婚当场反杀"
    assert merged["override_allowed"]["chapter_focus"] == "退婚当场反杀"


def test_merge_anti_patterns_deduplicates_by_text():
    rows = merge_anti_patterns(
        [{"text": "打脸节奏不能缺补刀", "source_table": "题材与调性推理", "source_id": "GR-001"}],
        [{"text": "打脸节奏不能缺补刀", "source_table": "爽点与节奏", "source_id": "PA-002"}],
    )

    assert [item["text"] for item in rows] == ["打脸节奏不能缺补刀"]
    assert rows[0]["source_table"] == "题材与调性推理"


def test_read_json_if_exists_returns_none_for_missing_file(tmp_path):
    assert read_json_if_exists(tmp_path / "missing.json") is None


def test_read_json_if_exists_raises_value_error_with_path(tmp_path):
    bad_path = tmp_path / "bad.json"
    bad_path.write_text("{bad json", encoding="utf-8")

    with pytest.raises(ValueError) as exc:
        read_json_if_exists(bad_path)

    assert str(bad_path) in str(exc.value)


def test_read_json_if_exists_loads_valid_json(tmp_path):
    path = tmp_path / "payload.json"
    path.write_text(json.dumps({"ok": True}, ensure_ascii=False), encoding="utf-8")

    assert read_json_if_exists(path) == {"ok": True}
