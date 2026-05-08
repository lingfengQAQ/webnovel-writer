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

    outline_dir = tmp_path / "大纲"
    outline_dir.mkdir(parents=True, exist_ok=True)
    (outline_dir / "第1卷-详细大纲.md").write_text("### 第1章：测试标题\n测试大纲", encoding="utf-8")

    draft_path = module.default_chapter_draft_path(tmp_path, 1)

    assert draft_path.name == "第0001章-测试标题.md"


def test_default_chapter_draft_path_falls_back_to_split_outline_filename(tmp_path):
    module = _load_module()

    outline_dir = tmp_path / "大纲"
    outline_dir.mkdir(parents=True, exist_ok=True)
    (outline_dir / "第0002章-标题 文件.md").write_text("无章节标题 heading", encoding="utf-8")

    draft_path = module.default_chapter_draft_path(tmp_path, 2)

    assert draft_path.name == "第0002章-标题_文件.md"


def test_find_chapter_file_supports_titled_flat_filename(tmp_path):
    module = _load_module()

    chapter_path = tmp_path / "正文" / "第0003章-山雨欲来.md"
    chapter_path.parent.mkdir(parents=True, exist_ok=True)
    chapter_path.write_text("正文", encoding="utf-8")

    found = module.find_chapter_file(tmp_path, 3)

    assert found == chapter_path
