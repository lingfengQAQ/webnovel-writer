#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Project memory writer for /webnovel-learn."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from runtime_compat import enable_windows_utf8_stdio
from security_utils import atomic_write_json


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _load_json_required(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"JSON 解析失败: {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"JSON 顶层必须是 object: {path}")
    return data


def _current_chapter(project_root: Path) -> Optional[int]:
    state_path = project_root / ".webnovel" / "state.json"
    if not state_path.exists():
        return None
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    progress = state.get("progress") if isinstance(state, dict) else {}
    chapter = progress.get("current_chapter") if isinstance(progress, dict) else None
    try:
        return int(chapter) if chapter is not None else None
    except (TypeError, ValueError):
        return None


def add_pattern(
    project_root: Path,
    *,
    pattern_type: str,
    description: str,
    category: str = "",
    importance: str = "medium",
    source_chapter: Optional[int] = None,
) -> Dict[str, Any]:
    project_root = project_root.expanduser().resolve()
    memory_path = project_root / ".webnovel" / "project_memory.json"
    payload = _load_json_required(memory_path)
    patterns = payload.setdefault("patterns", [])
    if not isinstance(patterns, list):
        raise ValueError(f"patterns 必须是数组: {memory_path}")

    pattern_type = (pattern_type or "other").strip() or "other"
    description = (description or "").strip()
    if not description:
        raise ValueError("description 不能为空")

    for item in patterns:
        if not isinstance(item, dict):
            continue
        if item.get("pattern_type") == pattern_type and item.get("description") == description:
            return {"status": "skipped", "reason": "duplicate", "learned": item}

    now = _utc_now_iso()
    chapter = source_chapter if source_chapter is not None else _current_chapter(project_root)
    learned: Dict[str, Any] = {
        "pattern_type": pattern_type,
        "description": description,
        "source_chapter": chapter,
        "learned_at": now,
        "updated_at": now,
    }
    if category:
        learned["category"] = category
    if importance:
        learned["importance"] = importance

    patterns.append(learned)
    atomic_write_json(memory_path, payload, use_lock=True, backup=True)
    return {"status": "success", "learned": learned, "path": str(memory_path)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Write .webnovel/project_memory.json safely")
    parser.add_argument("--project-root", required=True)
    sub = parser.add_subparsers(dest="command", required=True)

    add = sub.add_parser("add-pattern", help="追加一条项目经验记忆")
    add.add_argument("--pattern-type", default="other")
    add.add_argument("--description", required=True)
    add.add_argument("--category", default="")
    add.add_argument("--importance", default="medium")
    add.add_argument("--source-chapter", type=int)

    args = parser.parse_args()
    try:
        if args.command == "add-pattern":
            result = add_pattern(
                Path(args.project_root),
                pattern_type=args.pattern_type,
                description=args.description,
                category=args.category,
                importance=args.importance,
                source_chapter=args.source_chapter,
            )
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return
    except ValueError as exc:
        print(json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)

    raise SystemExit(2)


if __name__ == "__main__":
    if sys.platform == "win32":
        enable_windows_utf8_stdio()
    main()
