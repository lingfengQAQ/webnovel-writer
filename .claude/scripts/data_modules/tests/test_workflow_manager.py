#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import sys
from pathlib import Path


def _load_module():
    scripts_dir = Path(__file__).resolve().parents[2]
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    import workflow_manager

    return workflow_manager


def test_workflow_lifecycle_and_trace(tmp_path, monkeypatch):
    module = _load_module()
    monkeypatch.setattr(module, "find_project_root", lambda: tmp_path)

    webnovel_dir = tmp_path / ".webnovel"
    webnovel_dir.mkdir(parents=True, exist_ok=True)

    module.start_task("webnovel-write", {"chapter_num": 7})
    module.start_step("Step 1", "Context")
    module.complete_step("Step 1", json.dumps({"state_json_modified": True}, ensure_ascii=False))
    module.complete_task(json.dumps({"review_completed": True}, ensure_ascii=False))

    state = module.load_state()
    assert state["current_task"] is None
    assert state["history"][-1]["status"] == module.TASK_STATUS_COMPLETED
    assert state["last_stable_state"]["artifacts"]["review_completed"] is True

    trace_path = module.get_call_trace_path()
    assert trace_path.exists()
    lines = trace_path.read_text(encoding="utf-8").strip().splitlines()
    events = [json.loads(line)["event"] for line in lines if line.strip()]
    assert "task_started" in events
    assert "step_started" in events
    assert "step_completed" in events
    assert "task_completed" in events


def test_start_task_reentry_increments_retry(tmp_path, monkeypatch):
    module = _load_module()
    monkeypatch.setattr(module, "find_project_root", lambda: tmp_path)

    webnovel_dir = tmp_path / ".webnovel"
    webnovel_dir.mkdir(parents=True, exist_ok=True)

    module.start_task("webnovel-write", {"chapter_num": 8})
    module.start_task("webnovel-write", {"chapter_num": 8})

    state = module.load_state()
    task = state["current_task"]
    assert task is not None
    assert task["status"] == module.TASK_STATUS_RUNNING
    assert int(task.get("retry_count", 0)) >= 1


def test_complete_step_rejects_mismatch_step_id(tmp_path, monkeypatch):
    module = _load_module()
    monkeypatch.setattr(module, "find_project_root", lambda: tmp_path)

    webnovel_dir = tmp_path / ".webnovel"
    webnovel_dir.mkdir(parents=True, exist_ok=True)

    module.start_task("webnovel-write", {"chapter_num": 9})
    module.start_step("Step 2A", "Draft")
    module.complete_step("Step 2B")

    state = module.load_state()
    current_step = state["current_task"]["current_step"]
    assert current_step is not None
    assert current_step["id"] == "Step 2A"
    assert current_step["status"] == module.STEP_STATUS_RUNNING

