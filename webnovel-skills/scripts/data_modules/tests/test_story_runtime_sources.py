#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json

from data_modules.story_runtime_sources import load_runtime_sources


def test_load_runtime_sources_prefers_latest_accepted_commit(tmp_path):
    story_root = tmp_path / ".story-system"
    (story_root / "chapters").mkdir(parents=True, exist_ok=True)
    (story_root / "volumes").mkdir(parents=True, exist_ok=True)
    (story_root / "reviews").mkdir(parents=True, exist_ok=True)
    (story_root / "commits").mkdir(parents=True, exist_ok=True)

    (story_root / "MASTER_SETTING.json").write_text(
        json.dumps({"meta": {"contract_type": "MASTER_SETTING"}, "route": {"primary_genre": "玄幻"}}, ensure_ascii=False),
        encoding="utf-8",
    )
    (story_root / "chapters" / "chapter_003.json").write_text(
        json.dumps({"meta": {"contract_type": "CHAPTER_BRIEF", "chapter": 3}}, ensure_ascii=False),
        encoding="utf-8",
    )
    (story_root / "volumes" / "volume_001.json").write_text(
        json.dumps({"meta": {"contract_type": "VOLUME_BRIEF", "volume": 1}}, ensure_ascii=False),
        encoding="utf-8",
    )
    (story_root / "reviews" / "chapter_003.review.json").write_text(
        json.dumps({"meta": {"contract_type": "REVIEW_CONTRACT", "chapter": 3}}, ensure_ascii=False),
        encoding="utf-8",
    )
    (story_root / "commits" / "chapter_003.commit.json").write_text(
        json.dumps(
            {
                "meta": {"schema_version": "story-system/v1", "chapter": 3, "status": "accepted"},
                "provenance": {"write_fact_role": "chapter_commit"},
                "projection_status": {"state": "done", "index": "done", "summary": "done", "memory": "done"},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    snapshot = load_runtime_sources(tmp_path, chapter=3)

    assert snapshot.latest_accepted_commit["meta"]["status"] == "accepted"
    assert snapshot.primary_write_source == "chapter_commit"
    assert snapshot.fallback_sources == []
