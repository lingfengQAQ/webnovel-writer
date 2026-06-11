#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import subprocess
import sys
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parents[1].parent
HOOKS_JSON = PLUGIN_ROOT / "hooks" / "hooks.json"
GUARD = PLUGIN_ROOT / "hooks" / "guard_runtime_write.py"
SESSION_START = PLUGIN_ROOT / "hooks" / "session_start.py"


def _run_guard(payload: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(GUARD)],
        input=json.dumps(payload, ensure_ascii=False),
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def test_hooks_json_uses_plugin_wrapper_and_plugin_root_paths():
    payload = json.loads(HOOKS_JSON.read_text(encoding="utf-8"))

    assert "description" in payload
    assert "hooks" in payload
    assert "SessionStart" in payload["hooks"]
    assert "PreToolUse" in payload["hooks"]
    serialized = json.dumps(payload, ensure_ascii=False)
    assert "${CLAUDE_PLUGIN_ROOT}" in serialized
    assert "C:\\Users" not in serialized


def test_guard_blocks_direct_commit_file_write():
    proc = _run_guard(
        {
            "tool_name": "Write",
            "tool_input": {"file_path": r"D:\book\.story-system\commits\chapter_001.commit.json"},
        }
    )

    assert proc.returncode == 2
    assert "permissionDecision" in proc.stderr


def test_guard_allows_direct_state_write():
    # issue #113: audit fixes need direct state.json edits; the guard no
    # longer blocks them.
    proc = _run_guard(
        {
            "tool_name": "Edit",
            "tool_input": {"file_path": r"D:\book\.webnovel\state.json"},
        }
    )

    assert proc.returncode == 0


def test_guard_allows_bash_state_write():
    proc = _run_guard(
        {
            "tool_name": "Bash",
            "tool_input": {"command": 'python fix_state.py > "D:/book/.webnovel/state.json"'},
        }
    )

    assert proc.returncode == 0


def test_guard_still_blocks_index_db_write():
    proc = _run_guard(
        {
            "tool_name": "Edit",
            "tool_input": {"file_path": r"D:\book\.webnovel\index.db"},
        }
    )

    assert proc.returncode == 2


def test_guard_allows_runtime_projection_command():
    proc = _run_guard(
        {
            "tool_name": "Bash",
            "tool_input": {
                "command": 'python -X utf8 "${SCRIPTS_DIR}/webnovel.py" --project-root "${PROJECT_ROOT}" projections retry --chapter 3'
            },
        }
    )

    assert proc.returncode == 0


def test_guard_blocks_direct_chapter_commit_script_bypass():
    proc = _run_guard(
        {
            "tool_name": "Bash",
            "tool_input": {"command": "python scripts/chapter_commit.py --project-root book --chapter 3"},
        }
    )

    assert proc.returncode == 2


def test_session_start_can_be_disabled(monkeypatch):
    monkeypatch.setenv("WEBNOVEL_DISABLE_SESSION_STATUS_HOOK", "1")
    proc = subprocess.run(
        [sys.executable, str(SESSION_START)],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )

    assert proc.returncode == 0
    assert proc.stdout == ""
