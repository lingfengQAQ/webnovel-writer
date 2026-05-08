#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""章节状态模型测试"""
import json
import sys
import pytest
from pathlib import Path


@pytest.fixture
def state_project(tmp_path):
    webnovel_dir = tmp_path / ".webnovel"
    webnovel_dir.mkdir()
    state_file = webnovel_dir / "state.json"
    state_file.write_text(json.dumps({
        "progress": {"current_chapter": 5}
    }), encoding="utf-8")
    return tmp_path


def _make_manager(project_root):
    scripts_dir = str(Path(__file__).resolve().parent.parent.parent)
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from data_modules.config import DataModulesConfig
    from data_modules.state_manager import StateManager
    config = DataModulesConfig.from_project_root(project_root)
    return StateManager(config, enable_sqlite_sync=False)


def test_get_chapter_status_default(state_project):
    sm = _make_manager(state_project)
    sm._load_state()
    status = sm.get_chapter_status(5)
    assert status is None


def test_set_chapter_status_drafted(state_project):
    sm = _make_manager(state_project)
    sm._load_state()
    sm.set_chapter_status(5, "chapter_drafted")
    status = sm.get_chapter_status(5)
    assert status == "chapter_drafted"


def test_set_chapter_status_monotonic(state_project):
    sm = _make_manager(state_project)
    sm._load_state()
    sm.set_chapter_status(5, "chapter_reviewed")
    with pytest.raises(ValueError, match="不可回退"):
        sm.set_chapter_status(5, "chapter_drafted")


def test_set_chapter_status_progression(state_project):
    sm = _make_manager(state_project)
    sm._load_state()
    sm.set_chapter_status(5, "chapter_drafted")
    sm.set_chapter_status(5, "chapter_reviewed")
    sm.set_chapter_status(5, "chapter_committed")
    assert sm.get_chapter_status(5) == "chapter_committed"


def test_set_chapter_status_idempotent(state_project):
    sm = _make_manager(state_project)
    sm._load_state()
    sm.set_chapter_status(5, "chapter_drafted")
    sm.set_chapter_status(5, "chapter_drafted")  # should not raise
    assert sm.get_chapter_status(5) == "chapter_drafted"


def test_set_chapter_status_invalid(state_project):
    sm = _make_manager(state_project)
    sm._load_state()
    with pytest.raises(ValueError, match="无效状态"):
        sm.set_chapter_status(5, "invalid_status")


def test_chapter_status_persists(state_project):
    sm = _make_manager(state_project)
    sm._load_state()
    sm.set_chapter_status(3, "chapter_drafted")

    sm2 = _make_manager(state_project)
    sm2._load_state()
    assert sm2.get_chapter_status(3) == "chapter_drafted"
