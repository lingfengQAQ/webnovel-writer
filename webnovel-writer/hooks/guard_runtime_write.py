#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import PurePosixPath, PureWindowsPath
from typing import Any


DISABLE_ENV = "WEBNOVEL_DISABLE_RUNTIME_GUARD_HOOK"
# state.json is intentionally NOT protected: audits routinely require bulk
# fixes that update_state.py flags cannot express, and state.json has its own
# backup + rebuild path (issue #113).
PROTECTED_SUFFIXES = (
    ".story-system/commits/",
    ".webnovel/index.db",
    ".webnovel/vectors.db",
    ".webnovel/memory_scratchpad.json",
    ".webnovel/projection_log.jsonl",
)
ALLOWED_RUNTIME_MARKERS = (
    "webnovel.py",
    "chapter-commit",
    "write-gate",
    "projections retry",
    "projections replay",
)


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _load_input() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _normalized_path(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    raw = raw.replace("\\", "/")
    try:
        if ":" in raw[:3]:
            raw = PureWindowsPath(str(value)).as_posix()
        else:
            raw = PurePosixPath(raw).as_posix()
    except Exception:
        pass
    return raw.lower()


def _deny(message: str) -> int:
    payload = {
        "hookSpecificOutput": {"permissionDecision": "deny"},
        "systemMessage": message,
    }
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr)
    return 2


def _tool_input(payload: dict[str, Any]) -> dict[str, Any]:
    value = payload.get("tool_input") or payload.get("toolInput") or payload.get("input") or {}
    return value if isinstance(value, dict) else {}


def _tool_name(payload: dict[str, Any]) -> str:
    return str(payload.get("tool_name") or payload.get("toolName") or payload.get("tool") or "").strip()


def _file_path_from_tool_input(tool_input: dict[str, Any]) -> str:
    for key in ("file_path", "path", "filename"):
        value = tool_input.get(key)
        if value:
            return str(value)
    return ""


def _is_protected_path(path: str) -> bool:
    normalized = _normalized_path(path)
    if not normalized:
        return False
    return any(suffix in normalized for suffix in PROTECTED_SUFFIXES)


def _command_is_runtime_safe(command: str) -> bool:
    lowered = command.lower()
    return all(marker in lowered for marker in ("webnovel.py",)) and any(
        marker in lowered for marker in ("chapter-commit", "projections retry", "projections replay")
    )


def _looks_like_direct_projection_write(command: str) -> bool:
    lowered = command.lower().replace("\\", "/")
    if _command_is_runtime_safe(lowered):
        return False
    protected_hit = any(suffix in lowered for suffix in PROTECTED_SUFFIXES)
    if protected_hit and re.search(r"\b(>|out-file|set-content|add-content|copy-item|move-item|python|python3)\b", lowered):
        return True
    if "chapter_commit.py" in lowered and "webnovel.py" not in lowered:
        return True
    return False


def main() -> int:
    if _truthy(os.environ.get(DISABLE_ENV)):
        return 0

    payload = _load_input()
    tool_input = _tool_input(payload)
    tool = _tool_name(payload)

    command = str(tool_input.get("command") or "")
    if tool.lower() == "bash" or command:
        if _looks_like_direct_projection_write(command):
            return _deny(
                "webnovel-writer blocked a direct write or bypass command for Story System/read-model files. Use webnovel.py write-gate, chapter-commit, or projections retry/replay instead."
            )
        return 0

    path = _file_path_from_tool_input(tool_input)
    if _is_protected_path(path):
        return _deny(
            "webnovel-writer blocked a direct edit to Story System/read-model files. Use runtime commands so commit/projection invariants stay consistent."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
