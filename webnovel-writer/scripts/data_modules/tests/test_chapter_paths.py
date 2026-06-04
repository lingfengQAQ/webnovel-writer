#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
from pathlib import Path


def _load_module():
    scripts_dir = Path(__file__).resolve().parents[2]
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))

    import chapter_paths

    return chapter_paths


def test_default_chapter_draft_path_uses_outline_heading_title(tmp_path):
    module = _load_module()

    outline_dir = tmp_path / "outline"
    outline_dir.mkdir(parents=True, exist_ok=True)
    # 디렉터리는 영문(outline), 권 대강 아티팩트 파일명은 내부 계약(현 단계 유지),
    # 헤딩은 신규 한국어 "N화" 형식.
    (outline_dir / "第1卷-详细大纲.md").write_text("### 1화: 테스트제목\n테스트 대강", encoding="utf-8")

    draft_path = module.default_chapter_draft_path(tmp_path, 1)

    assert draft_path.name == "ch0001-테스트제목.md"


def test_default_chapter_draft_path_reads_legacy_chinese_outline(tmp_path):
    """레거시(중국어) 대강도 읽어 제목을 추출하되, 새 파일명은 ASCII 토큰으로 생성."""
    module = _load_module()

    outline_dir = tmp_path / "大纲"
    outline_dir.mkdir(parents=True, exist_ok=True)
    (outline_dir / "第1卷-详细大纲.md").write_text("### 第1章：测试标题\n测试大纲", encoding="utf-8")

    draft_path = module.default_chapter_draft_path(tmp_path, 1)

    assert draft_path.name == "ch0001-测试标题.md"


def test_default_chapter_draft_path_falls_back_to_split_outline_filename(tmp_path):
    module = _load_module()

    outline_dir = tmp_path / "outline"
    outline_dir.mkdir(parents=True, exist_ok=True)
    (outline_dir / "ch0002-제목 파일.md").write_text("제목 헤딩 없음", encoding="utf-8")

    draft_path = module.default_chapter_draft_path(tmp_path, 2)

    assert draft_path.name == "ch0002-제목_파일.md"


def test_find_chapter_file_supports_titled_flat_filename(tmp_path):
    module = _load_module()

    chapter_path = tmp_path / "manuscript" / "ch0003-폭풍전야.md"
    chapter_path.parent.mkdir(parents=True, exist_ok=True)
    chapter_path.write_text("본문", encoding="utf-8")

    found = module.find_chapter_file(tmp_path, 3)

    assert found == chapter_path


def test_find_chapter_file_reads_legacy_chinese_manuscript(tmp_path):
    """레거시(중국어) 원고 디렉터리/파일명도 읽기 호환."""
    module = _load_module()

    chapter_path = tmp_path / "正文" / "第0003章-山雨欲来.md"
    chapter_path.parent.mkdir(parents=True, exist_ok=True)
    chapter_path.write_text("正文", encoding="utf-8")

    found = module.find_chapter_file(tmp_path, 3)

    assert found == chapter_path
