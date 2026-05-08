#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from pathlib import Path

import pytest


def _load_archive_module():
    import sys

    scripts_dir = Path(__file__).resolve().parents[2]
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))

    import archive_manager

    return archive_manager


@pytest.fixture
def archive_env(tmp_path):
    webnovel = tmp_path / ".webnovel"
    webnovel.mkdir(parents=True, exist_ok=True)
    state_path = webnovel / "state.json"
    state_path.write_text(
        '{"progress":{"current_chapter":10},"plot_threads":{},"review_checkpoints":[]}',
        encoding="utf-8",
    )
    return tmp_path


def test_archive_remove_from_state_missing_sections(archive_env):
    module = _load_archive_module()
    manager = module.ArchiveManager(project_root=archive_env)

    state = {
        "progress": {"current_chapter": 50},
    }

    updated = manager.remove_from_state(state, inactive_chars=[], resolved_threads=[], old_reviews=[])
    assert updated.get("progress", {}).get("current_chapter") == 50


def test_archive_check_trigger_conditions_edges(archive_env):
    module = _load_archive_module()
    manager = module.ArchiveManager(project_root=archive_env)

    manager.config["chapter_trigger"] = 10
    manager.config["file_size_trigger_mb"] = 9999.0

    trigger = manager.check_trigger_conditions({"progress": {"current_chapter": 20}})
    assert trigger["chapter_trigger"] is True
    assert trigger["should_archive"] is True


def test_archive_identify_old_reviews_handles_mixed_formats(archive_env):
    module = _load_archive_module()
    manager = module.ArchiveManager(project_root=archive_env)
    manager.config["review_old_threshold"] = 5

    state = {
        "progress": {"current_chapter": 30},
        "review_checkpoints": [
            {"chapters": "20-22", "report": "r1.md"},
            {"chapter_range": [10, 12], "date": "2026-01-01"},
            {"report": "Review_Ch5-6.md"},
        ],
    }

    results = manager.identify_old_reviews(state)
    assert len(results) == 3
    assert all(row["chapters_since_review"] >= 5 for row in results)

