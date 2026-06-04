#!/usr/bin/env python3
"""
챕터 파일 경로 헬퍼.

이 프로젝트는 여러 챕터 파일명 규칙을 거쳐왔다:
1) 평탄 레이아웃: manuscript/ch0007.md
2) 권 레이아웃:   manuscript/vol01/ch007-제목.md

레거시(중국어) 레이아웃(正文/第0007章.md, 正文/第1卷/...)도 "읽기"는 호환한다.
스크립트가 견고하도록, 항상 이 헬퍼로 챕터 파일을 해석하고 포맷을 직접 하드코딩하지 않는다.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

try:
    from data_modules.naming import (
        DIR_MANUSCRIPT,
        DIR_OUTLINE,
        CHAPTER_NUM_RE,
        LEGACY_CHAPTER_NUM_RE,
        OUTLINE_HEADING_RE,
        SPLIT_OUTLINE_FILENAME_RE,
        CHAPTERS_PER_VOLUME,
        CHAPTER_PREFIX,
        chapter_token,
        volume_token,
    )
except ImportError:  # pragma: no cover
    from scripts.data_modules.naming import (
        DIR_MANUSCRIPT,
        DIR_OUTLINE,
        CHAPTER_NUM_RE,
        LEGACY_CHAPTER_NUM_RE,
        OUTLINE_HEADING_RE,
        SPLIT_OUTLINE_FILENAME_RE,
        CHAPTERS_PER_VOLUME,
        CHAPTER_PREFIX,
        chapter_token,
        volume_token,
    )


def volume_num_for_chapter(chapter_num: int, *, chapters_per_volume: int = CHAPTERS_PER_VOLUME) -> int:
    if chapter_num <= 0:
        raise ValueError("chapter_num must be >= 1")
    return (chapter_num - 1) // chapters_per_volume + 1


def extract_chapter_num_from_filename(filename: str) -> Optional[int]:
    m = CHAPTER_NUM_RE.search(filename) or LEGACY_CHAPTER_NUM_RE.search(filename)
    if not m:
        return None
    try:
        return int(m.group("num"))
    except ValueError:
        return None


def _safe_title_for_filename(title: str) -> str:
    cleaned = title.strip()
    if not cleaned:
        return ""

    try:
        from security_utils import sanitize_filename
    except ImportError:  # pragma: no cover
        from scripts.security_utils import sanitize_filename

    safe_title = sanitize_filename(cleaned, max_length=60)
    return "" if safe_title == "unnamed_entity" else safe_title


def _extract_title_from_outline_text(outline_text: str, chapter_num: int) -> str:
    for match in OUTLINE_HEADING_RE.finditer(outline_text):
        if int(match.group("num")) != chapter_num:
            continue
        return _safe_title_for_filename(match.group("title"))
    return ""


def _extract_title_from_split_outline_filename(outline_dir: Path, chapter_num: int) -> str:
    patterns = [
        # 영문 토큰(신규)
        f"{CHAPTER_PREFIX}{chapter_num}*.md",
        f"{CHAPTER_PREFIX}{chapter_num:02d}*.md",
        f"{CHAPTER_PREFIX}{chapter_num:03d}*.md",
        f"{CHAPTER_PREFIX}{chapter_num:04d}*.md",
        # 레거시(중국어) 분할 대강 파일 읽기 호환
        f"第{chapter_num}章*.md",
        f"第{chapter_num:02d}章*.md",
        f"第{chapter_num:03d}章*.md",
        f"第{chapter_num:04d}章*.md",
    ]
    for pattern in patterns:
        for path in sorted(outline_dir.glob(pattern)):
            match = SPLIT_OUTLINE_FILENAME_RE.match(path.name)
            if not match:
                continue
            if int(match.group("num")) != chapter_num:
                continue
            title = _safe_title_for_filename(match.group("title"))
            if title:
                return title
    return ""


def extract_chapter_title(project_root: Path, chapter_num: int) -> str:
    """상세 대강에서 챕터 제목을 추출해 더 직관적인 챕터 파일명을 생성한다."""
    try:
        from chapter_outline_loader import load_chapter_outline
    except ImportError:  # pragma: no cover
        from scripts.chapter_outline_loader import load_chapter_outline

    outline_text = load_chapter_outline(project_root, chapter_num, max_chars=None)
    if not outline_text.startswith("⚠️"):
        title = _extract_title_from_outline_text(outline_text, chapter_num)
        if title:
            return title

    outline_dir = project_root / DIR_OUTLINE
    if not outline_dir.exists():
        # 레거시 중국어 대강 디렉터리 읽기 호환
        legacy_outline = project_root / "大纲"
        outline_dir = legacy_outline if legacy_outline.exists() else outline_dir
    if outline_dir.exists():
        return _extract_title_from_split_outline_filename(outline_dir, chapter_num)
    return ""


def _build_chapter_filename(project_root: Path, chapter_num: int, *, use_volume_layout: bool) -> str:
    token = chapter_token(chapter_num, use_volume_layout=use_volume_layout)
    title = extract_chapter_title(project_root, chapter_num)
    if title:
        return f"{token}-{title}.md"
    return f"{token}.md"


def _manuscript_dir(project_root: Path) -> Path:
    """원고 디렉터리. 영문 우선, 레거시(중국어)는 읽기 호환."""
    eng = project_root / DIR_MANUSCRIPT
    if eng.exists():
        return eng
    legacy = project_root / "正文"
    if legacy.exists():
        return legacy
    return eng


def find_chapter_file(project_root: Path, chapter_num: int) -> Optional[Path]:
    """
    project_root/manuscript 아래에서 chapter_num에 해당하는 기존 챕터 파일을 찾는다.
    레거시(中) 파일명도 함께 탐색한다. 첫 매치(안정 정렬) 또는 None을 반환.
    """
    chapters_dir = _manuscript_dir(project_root)
    if not chapters_dir.exists():
        return None

    # 평탄 레이아웃 직접 후보
    flat = chapters_dir / f"{chapter_token(chapter_num)}.md"
    if flat.exists():
        return flat
    legacy_flat = chapters_dir / f"第{chapter_num:04d}章.md"
    if legacy_flat.exists():
        return legacy_flat

    # 권 레이아웃
    vol_num = volume_num_for_chapter(chapter_num)
    for vol_dir in (chapters_dir / volume_token(vol_num), chapters_dir / f"第{vol_num}卷"):
        if vol_dir.exists():
            candidates = (
                sorted(vol_dir.glob(f"{chapter_token(chapter_num, use_volume_layout=True)}*.md"))
                + sorted(vol_dir.glob(f"{chapter_token(chapter_num)}*.md"))
                + sorted(vol_dir.glob(f"第{chapter_num:03d}章*.md"))
                + sorted(vol_dir.glob(f"第{chapter_num:04d}章*.md"))
            )
            for c in candidates:
                if c.is_file():
                    return c

    # 폴백: manuscript 하위 어디든 검색(커스텀 레이아웃 지원)
    candidates = (
        sorted(chapters_dir.rglob(f"{chapter_token(chapter_num, use_volume_layout=True)}*.md"))
        + sorted(chapters_dir.rglob(f"{chapter_token(chapter_num)}*.md"))
        + sorted(chapters_dir.rglob(f"第{chapter_num:03d}章*.md"))
        + sorted(chapters_dir.rglob(f"第{chapter_num:04d}章*.md"))
    )
    for c in candidates:
        if c.is_file():
            return c

    return None


def default_chapter_draft_path(project_root: Path, chapter_num: int, *, use_volume_layout: bool = False) -> Path:
    """
    새 챕터 파일을 만들 때의 기본 경로. 쓰기는 항상 영문 토큰을 사용한다.

    Args:
        project_root: 프로젝트 루트
        chapter_num: 챕터 번호
        use_volume_layout: True면 권 레이아웃(manuscript/vol01/ch007-제목.md),
                           False면 평탄 레이아웃(manuscript/ch0007-제목.md)

    기본은 평탄 레이아웃. 상세 대강에 챕터 제목이 이미 있으면 파일명에 덧붙인다.
    """
    if use_volume_layout:
        vol_dir = project_root / DIR_MANUSCRIPT / volume_token(volume_num_for_chapter(chapter_num))
        return vol_dir / _build_chapter_filename(project_root, chapter_num, use_volume_layout=True)
    else:
        return project_root / DIR_MANUSCRIPT / _build_chapter_filename(project_root, chapter_num, use_volume_layout=False)
