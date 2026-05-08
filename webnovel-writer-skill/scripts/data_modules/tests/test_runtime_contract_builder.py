#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json

from data_modules.runtime_contract_builder import RuntimeContractBuilder


def test_runtime_contract_builder_creates_volume_and_review_contracts(tmp_path):
    project_root = tmp_path
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text(
        json.dumps(
            {
                "progress": {"volumes_planned": [{"volume": 1, "chapters_range": "1-20"}]},
                "chapter_meta": {},
                "disambiguation_pending": [],
                "disambiguation_warnings": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (project_root / ".story-system" / "MASTER_SETTING.json").parent.mkdir(parents=True, exist_ok=True)
    (project_root / ".story-system" / "MASTER_SETTING.json").write_text(
        json.dumps(
            {
                "meta": {"schema_version": "story-system/v1", "contract_type": "MASTER_SETTING"},
                "route": {"primary_genre": "玄幻退婚流"},
                "master_constraints": {"core_tone": "先压后爆"},
                "base_context": [],
                "source_trace": [],
                "override_policy": {"locked": ["route.primary_genre"], "append_only": ["anti_patterns"], "override_allowed": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (project_root / ".story-system" / "anti_patterns.json").write_text(
        json.dumps([{"text": "配角不能抢主角兑现"}], ensure_ascii=False),
        encoding="utf-8",
    )
    (project_root / "大纲").mkdir(parents=True, exist_ok=True)
    (project_root / "大纲" / "第1卷-详细大纲.md").write_text(
        "### 第3章：试压\nCBN：继续压迫\n必须覆盖节点：发现陷阱、决定隐忍\n本章禁区：不可提前摊牌",
        encoding="utf-8",
    )

    builder = RuntimeContractBuilder(project_root)
    volume_brief, review_contract = builder.build_for_chapter(3)

    assert volume_brief["meta"]["contract_type"] == "VOLUME_BRIEF"
    assert review_contract["meta"]["contract_type"] == "REVIEW_CONTRACT"
    assert "发现陷阱" in review_contract["must_check"]
    assert "不可提前摊牌" in review_contract["blocking_rules"]


def test_runtime_contract_builder_surfaces_review_extracted_anti_patterns(tmp_path):
    project_root = tmp_path
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text(
        json.dumps({"progress": {"volumes_planned": []}}, ensure_ascii=False),
        encoding="utf-8",
    )
    story_root = project_root / ".story-system"
    story_root.mkdir(parents=True, exist_ok=True)
    (story_root / "MASTER_SETTING.json").write_text(
        json.dumps(
            {
                "meta": {"schema_version": "story-system/v1", "contract_type": "MASTER_SETTING"},
                "route": {"primary_genre": "仙侠"},
                "master_constraints": {"core_tone": "克制具体"},
                "base_context": [],
                "source_trace": [],
                "override_policy": {"locked": [], "append_only": ["anti_patterns"], "override_allowed": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (story_root / "anti_patterns.json").write_text(
        json.dumps(
            [
                {
                    "text": "唯一一个知道复利公式的人",
                    "source_table": "review_extracted",
                    "source_id": "ch0002_issue_1",
                }
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    volume_brief, review_contract = RuntimeContractBuilder(project_root).build_for_chapter(3)

    assert "唯一一个知道复利公式的人" in volume_brief["anti_patterns"]
    assert "唯一一个知道复利公式的人" in review_contract["anti_patterns"]
