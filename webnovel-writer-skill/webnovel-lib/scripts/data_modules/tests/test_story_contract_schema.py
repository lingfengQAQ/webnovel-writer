#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import pytest

from data_modules.story_contract_schema import ChapterBrief, MasterSetting, ReviewContract, VolumeBrief


def test_master_setting_and_chapter_brief_accept_phase1_seed_shape():
    master = MasterSetting.model_validate(
        {
            "meta": {"schema_version": "story-system/v1", "contract_type": "MASTER_SETTING"},
            "route": {"primary_genre": "玄幻退婚流"},
            "master_constraints": {"core_tone": "先压后爆", "pacing_strategy": "三章内首个反打"},
            "base_context": [],
            "source_trace": [],
            "override_policy": {"locked": ["route.primary_genre"], "append_only": ["anti_patterns"], "override_allowed": []},
        }
    )
    chapter = ChapterBrief.model_validate(
        {
            "meta": {"schema_version": "story-system/v1", "contract_type": "CHAPTER_BRIEF"},
            "override_allowed": {"chapter_focus": "退婚现场反打"},
            "dynamic_context": [],
            "source_trace": [],
        }
    )
    assert master.route["primary_genre"] == "玄幻退婚流"
    assert chapter.override_allowed["chapter_focus"] == "退婚现场反打"


def test_volume_brief_requires_selected_fields():
    payload = {
        "meta": {"schema_version": "story-system/v1", "contract_type": "VOLUME_BRIEF"},
        "volume_goal": {"summary": "卷一站稳脚跟"},
        "selected_tropes": ["退婚反击"],
        "selected_pacing": {"wave": "压抑后爆"},
        "selected_scenes": ["宗门大厅", "资源争夺"],
        "anti_patterns": ["配角抢主角兑现"],
        "system_constraints": ["金手指每日限一次"],
        "overrides": {"locked": {}, "append_only": {}, "override_allowed": {}},
    }
    model = VolumeBrief.model_validate(payload)
    assert model.volume_goal["summary"] == "卷一站稳脚跟"


def test_review_contract_requires_blocking_rules_list():
    with pytest.raises(Exception):
        ReviewContract.model_validate(
            {
                "meta": {"schema_version": "story-system/v1", "contract_type": "REVIEW_CONTRACT"},
                "must_check": ["mandatory_nodes"],
                "blocking_rules": "not-a-list",
                "genre_specific_risks": [],
                "anti_patterns": [],
                "system_constraints": [],
                "review_thresholds": {"blocking_count": 0},
                "overrides": {"locked": {}, "append_only": {}, "override_allowed": {}},
            }
        )
