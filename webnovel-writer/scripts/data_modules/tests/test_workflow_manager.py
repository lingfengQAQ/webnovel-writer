#!/usr/bin/env python3

import json
import logging
import sys
from pathlib import Path
from types import SimpleNamespace


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


def test_workflow_step_owner_and_order_violation_trace(tmp_path, monkeypatch):
    module = _load_module()
    monkeypatch.setattr(module, "find_project_root", lambda: tmp_path)

    webnovel_dir = tmp_path / ".webnovel"
    webnovel_dir.mkdir(parents=True, exist_ok=True)

    assert module.expected_step_owner("webnovel-write", "Step 1") == "context-agent"
    assert module.expected_step_owner("webnovel-write", "Step 5") == "data-agent"

    module.start_task("webnovel-write", {"chapter_num": 12})
    module.start_step("Step 3", "Review")

    trace_path = module.get_call_trace_path()
    lines = [json.loads(line) for line in trace_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    events = [row.get("event") for row in lines]
    assert "step_order_violation" in events

    step_started = [row for row in lines if row.get("event") == "step_started"]
    assert step_started
    assert step_started[-1].get("payload", {}).get("expected_owner") == "review-agents"


def test_safe_append_call_trace_logs_failure(monkeypatch, caplog):
    module = _load_module()

    def _raise_trace_error(event, payload=None):
        raise RuntimeError("trace failure")

    monkeypatch.setattr(module, "append_call_trace", _raise_trace_error)

    with caplog.at_level(logging.WARNING):
        module.safe_append_call_trace("unit_test_event", {"ok": True})

    message_text = "\n".join(record.getMessage() for record in caplog.records)
    assert "failed to append call trace" in message_text
    assert "unit_test_event" in message_text


def test_get_workflow_paths_support_zero_arg_find_project_root(tmp_path, monkeypatch):
    module = _load_module()
    monkeypatch.setattr(module, "_cli_project_root", None)
    monkeypatch.setattr(module, "find_project_root", lambda: tmp_path)

    assert module.get_workflow_state_path() == tmp_path / ".webnovel" / "workflow_state.json"
    assert module.get_call_trace_path() == tmp_path / ".webnovel" / "observability" / "call_trace.jsonl"


def test_workflow_reentry_does_not_duplicate_history(tmp_path, monkeypatch):
    module = _load_module()
    monkeypatch.setattr(module, "find_project_root", lambda: tmp_path)

    webnovel_dir = tmp_path / ".webnovel"
    webnovel_dir.mkdir(parents=True, exist_ok=True)

    module.start_task("webnovel-write", {"chapter_num": 20})
    module.start_task("webnovel-write", {"chapter_num": 20})
    module.start_task("webnovel-write", {"chapter_num": 20})

    state = module.load_state()
    assert isinstance(state.get("history"), list)
    assert len(state.get("history")) == 0

    task = state.get("current_task") or {}
    assert int(task.get("retry_count", 0)) >= 2


def test_cleanup_artifacts_requires_confirm(tmp_path, monkeypatch):
    module = _load_module()
    monkeypatch.setattr(module, "find_project_root", lambda: tmp_path)

    webnovel_dir = tmp_path / ".webnovel"
    webnovel_dir.mkdir(parents=True, exist_ok=True)

    draft_path = module.default_chapter_draft_path(tmp_path, 7)
    draft_path.parent.mkdir(parents=True, exist_ok=True)
    draft_path.write_text("draft", encoding="utf-8")

    git_called = {"count": 0}

    def _fake_run(*args, **kwargs):
        git_called["count"] += 1
        return SimpleNamespace(returncode=0, stderr="", stdout="")

    monkeypatch.setattr(module.subprocess, "run", _fake_run)

    preview = module.cleanup_artifacts(7, confirm=False)

    assert draft_path.exists()
    assert git_called["count"] == 0
    assert any(item.startswith("[预览]") for item in preview)


def test_cleanup_artifacts_confirm_deletes_with_backup(tmp_path, monkeypatch):
    module = _load_module()
    monkeypatch.setattr(module, "find_project_root", lambda: tmp_path)

    webnovel_dir = tmp_path / ".webnovel"
    webnovel_dir.mkdir(parents=True, exist_ok=True)

    draft_path = module.default_chapter_draft_path(tmp_path, 8)
    draft_path.parent.mkdir(parents=True, exist_ok=True)
    draft_path.write_text("draft", encoding="utf-8")

    git_called = {"count": 0, "cmd": None}

    def _fake_run(cmd, **kwargs):
        git_called["count"] += 1
        git_called["cmd"] = cmd
        return SimpleNamespace(returncode=0, stderr="", stdout="")

    monkeypatch.setattr(module.subprocess, "run", _fake_run)

    cleaned = module.cleanup_artifacts(8, confirm=True)

    assert not draft_path.exists()
    assert git_called["count"] == 1
    assert git_called["cmd"] == ["git", "reset", "HEAD", "."]
    assert any("Git 暂存区已清理" in item for item in cleaned)

    backup_dir = tmp_path / ".webnovel" / "recovery_backups"
    backups = list(backup_dir.glob("ch0008-*"))
    assert backups
