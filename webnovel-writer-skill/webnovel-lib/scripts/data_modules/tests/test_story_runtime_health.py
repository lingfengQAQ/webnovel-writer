#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json

from data_modules.story_runtime_health import build_story_runtime_health


def test_story_runtime_health_reports_missing_commit_as_not_ready(tmp_path):
    report = build_story_runtime_health(tmp_path, chapter=3)

    assert report["mainline_ready"] is False
    assert "missing_accepted_commit" in report["fallback_sources"]


def test_story_runtime_health_prefers_latest_story_system_chapter_over_state_projection(tmp_path):
    webnovel_dir = tmp_path / ".webnovel"
    webnovel_dir.mkdir(parents=True, exist_ok=True)
    (webnovel_dir / "state.json").write_text(
        json.dumps({"progress": {"current_chapter": 2}}, ensure_ascii=False),
        encoding="utf-8",
    )

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

    report = build_story_runtime_health(tmp_path)

    assert report["chapter"] == 3
    assert report["latest_commit_status"] == "rejected"
