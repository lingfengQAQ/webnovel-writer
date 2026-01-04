#!/usr/bin/env python3
"""
Chapter file path helpers.

This project has seen multiple chapter filename conventions:
1) Legacy flat layout: 正文/第0007章.md
2) Volume layout:    正文/第1卷/第007章-章节标题.md

To keep scripts robust, always resolve chapter files via these helpers instead of hardcoding a format.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional


_CHAPTER_NUM_RE = re.compile(r"第(?P<num>\d+)章")


def volume_num_for_chapter(chapter_num: int, *, chapters_per_volume: int = 50) -> int:
    if chapter_num <= 0:
        raise ValueError("chapter_num must be >= 1")
    return (chapter_num - 1) // chapters_per_volume + 1


def extract_chapter_num_from_filename(filename: str) -> Optional[int]:
    m = _CHAPTER_NUM_RE.search(filename)
    if not m:
        return None
    try:
        return int(m.group("num"))
    except ValueError:
        return None


def find_chapter_file(project_root: Path, chapter_num: int) -> Optional[Path]:
    """
    Find an existing chapter file for chapter_num under project_root/正文.
    Returns the first match (stable sorted order) or None if not found.
    """
    chapters_dir = project_root / "正文"
    if not chapters_dir.exists():
        return None

    legacy = chapters_dir / f"第{chapter_num:04d}章.md"
    if legacy.exists():
        return legacy

    vol_dir = chapters_dir / f"第{volume_num_for_chapter(chapter_num)}卷"
    if vol_dir.exists():
        candidates = sorted(vol_dir.glob(f"第{chapter_num:03d}章*.md")) + sorted(vol_dir.glob(f"第{chapter_num:04d}章*.md"))
        for c in candidates:
            if c.is_file():
                return c

    # Fallback: search anywhere under 正文/ (supports custom layouts)
    candidates = sorted(chapters_dir.rglob(f"第{chapter_num:03d}章*.md")) + sorted(chapters_dir.rglob(f"第{chapter_num:04d}章*.md"))
    for c in candidates:
        if c.is_file():
            return c

    return None


def default_chapter_draft_path(project_root: Path, chapter_num: int) -> Path:
    """
    Preferred draft path when creating a new chapter file.
    Title may be added later (rename) without breaking lookup.
    """
    vol_dir = project_root / "正文" / f"第{volume_num_for_chapter(chapter_num)}卷"
    return vol_dir / f"第{chapter_num:03d}章.md"

