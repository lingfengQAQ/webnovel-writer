#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .story_runtime_sources import load_runtime_sources


_CHAPTER_FILE_RE = re.compile(r"chapter_(\d{3,4})")


def _extract_chapter_from_name(path: Path) -> int:
    match = _CHAPTER_FILE_RE.search(path.name)
    if not match:
        return 0
    try:
        return int(match.group(1))
    except (TypeError, ValueError):
        return 0


def _latest_story_system_chapter(project_root: Path) -> int:
    story_root = project_root / ".story-system"
    if not story_root.is_dir():
        return 0

    candidates = []
    for pattern in (
        "chapters/chapter_*.json",
        "reviews/chapter_*.review.json",
        "commits/chapter_*.commit.json",
    ):
        for path in story_root.glob(pattern):
            candidates.append(_extract_chapter_from_name(path))
    return max(candidates or [0])


def _resolve_chapter(project_root: Path, chapter: int | None) -> int:
    if chapter is not None:
        try:
            return max(0, int(chapter))
        except (TypeError, ValueError):
            return 0

    latest_story_system_chapter = _latest_story_system_chapter(project_root)
    state_path = project_root / ".webnovel" / "state.json"
    if not state_path.is_file():
        return latest_story_system_chapter

    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return latest_story_system_chapter

    try:
        state_chapter = max(0, int(((state.get("progress") or {}).get("current_chapter") or 0)))
    except (TypeError, ValueError):
        state_chapter = 0
    return max(state_chapter, latest_story_system_chapter)


def build_story_runtime_health(project_root: Path, chapter: int | None = None) -> dict[str, Any]:
    project_root = Path(project_root)
    current_chapter = _resolve_chapter(project_root, chapter)
    if current_chapter <= 0:
        return {
            "chapter": 0,
            "mainline_ready": False,
            "fallback_sources": ["chapter_unspecified"],
            "latest_commit_status": "missing",
            "primary_write_source": "chapter_commit",
        }

    snapshot = load_runtime_sources(project_root, current_chapter)
    latest_commit = snapshot.latest_commit or {}
    return {
        "chapter": current_chapter,
        "mainline_ready": not snapshot.fallback_sources,
        "fallback_sources": list(snapshot.fallback_sources),
        "latest_commit_status": (latest_commit.get("meta") or {}).get("status", "missing"),
        "primary_write_source": snapshot.primary_write_source,
    }
