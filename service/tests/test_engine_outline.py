# -*- coding: utf-8 -*-
"""章纲路径解析测试。

覆盖修过的真实 bug：原实现只找 `大纲/第NNNN章.md`，而上游把章纲存在
`大纲/第N卷-详细大纲.md` 里按 `### 第N章：标题` 分节 —— 导致即使有章纲也读不到。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from service.engine import Engine

VOLUME_OUTLINE = """# 第1卷 详细大纲

> 覆盖第 1-50 章

### 第1章：废柴的绝路

**目标**：主角在绝境中觉醒
**CBN**：主角 | 面对 | 危机

### 第2章：三年之约

**目标**：立下三年之约
**CBN**：主角 | 立下 | 约定

### 第十章：中文数字章号

**目标**：验证中文数字解析
"""


class TestSectionExtraction:
    def test_extracts_requested_chapter(self):
        sec = Engine._extract_chapter_section(VOLUME_OUTLINE, 1)
        assert sec is not None
        assert sec.startswith("### 第1章")
        assert "废柴的绝路" in sec

    def test_section_stops_at_next_heading(self):
        sec = Engine._extract_chapter_section(VOLUME_OUTLINE, 1)
        assert "三年之约" not in sec

    def test_extracts_second_chapter(self):
        sec = Engine._extract_chapter_section(VOLUME_OUTLINE, 2)
        assert "三年之约" in sec
        assert "废柴的绝路" not in sec

    def test_last_section_runs_to_end(self):
        sec = Engine._extract_chapter_section(VOLUME_OUTLINE, 10)
        assert "中文数字章号" in sec

    def test_missing_chapter_returns_none(self):
        assert Engine._extract_chapter_section(VOLUME_OUTLINE, 99) is None

    def test_empty_content(self):
        assert Engine._extract_chapter_section("", 1) is None

    def test_no_headings(self):
        assert Engine._extract_chapter_section("随便一段文字", 1) is None

    def test_heading_without_colon_not_matched(self):
        """上游约定标题带全角冒号，不带冒号的不算章纲标题。"""
        assert Engine._extract_chapter_section("### 第1章 无冒号\n内容", 1) is None


class TestChapterNumParsing:
    @pytest.mark.parametrize("raw,expected", [
        ("1", 1), ("42", 42), ("100", 100),
        ("一", 1), ("二", 2), ("九", 9), ("十", 10),
        ("十一", 11), ("二十", 20), ("二十三", 23), ("九十九", 99),
    ])
    def test_parses(self, raw, expected):
        assert Engine._parse_chapter_num(raw) == expected

    @pytest.mark.parametrize("raw", ["", "  ", "abc", "第", "两"])
    def test_invalid_returns_none(self, raw):
        assert Engine._parse_chapter_num(raw) is None


class TestChapterOutlineResolution:
    """端到端：从磁盘解析章纲，含单章文件与卷大纲两种约定。"""

    def _engine(self, root: Path) -> Engine:
        from service.config import Settings
        s = Settings()
        s.llm.base_url = "http://x/v1"
        s.llm.model = "m"
        return Engine(s, project_root=str(root))

    def test_reads_volume_outline_section(self, tmp_path: Path):
        (tmp_path / "大纲").mkdir(parents=True, exist_ok=True)
        (tmp_path / "大纲" / "第1卷-详细大纲.md").write_text(
            VOLUME_OUTLINE, encoding="utf-8")
        eng = self._engine(tmp_path)
        out = eng.chapter_outline(1)
        assert out is not None
        assert "废柴的绝路" in out

    def test_prefers_split_chapter_file(self, tmp_path: Path):
        d = tmp_path / "大纲"
        d.mkdir(parents=True, exist_ok=True)
        (d / "第1卷-详细大纲.md").write_text(VOLUME_OUTLINE, encoding="utf-8")
        (d / "第1章-单独文件.md").write_text("### 第1章：单独文件优先", encoding="utf-8")
        eng = self._engine(tmp_path)
        assert "单独文件优先" in eng.chapter_outline(1)

    def test_zero_padded_split_file(self, tmp_path: Path):
        d = tmp_path / "大纲"
        d.mkdir(parents=True, exist_ok=True)
        (d / "第0001章-四位补零.md").write_text("四位补零内容", encoding="utf-8")
        eng = self._engine(tmp_path)
        assert "四位补零内容" in eng.chapter_outline(1)

    def test_volume_outline_with_space_variant(self, tmp_path: Path):
        """上游 _find_volume_outline_file 接受三种文件名变体。"""
        d = tmp_path / "大纲"
        d.mkdir(parents=True, exist_ok=True)
        (d / "第1卷 - 详细大纲.md").write_text(VOLUME_OUTLINE, encoding="utf-8")
        eng = self._engine(tmp_path)
        assert eng.chapter_outline(1) is not None

    def test_missing_outline_returns_none(self, tmp_path: Path):
        (tmp_path / "大纲").mkdir(parents=True, exist_ok=True)
        eng = self._engine(tmp_path)
        assert eng.chapter_outline(1) is None

    def test_no_outline_dir_returns_none(self, tmp_path: Path):
        eng = self._engine(tmp_path)
        assert eng.chapter_outline(1) is None

    def test_max_chars_truncates(self, tmp_path: Path):
        d = tmp_path / "大纲"
        d.mkdir(parents=True, exist_ok=True)
        (d / "第1卷-详细大纲.md").write_text(VOLUME_OUTLINE, encoding="utf-8")
        eng = self._engine(tmp_path)
        out = eng.chapter_outline(1, max_chars=20)
        assert out is not None and len(out) <= 20


class TestVolumeForChapter:
    def _engine(self, root: Path) -> Engine:
        from service.config import Settings
        s = Settings()
        s.llm.base_url = "http://x/v1"
        s.llm.model = "m"
        return Engine(s, project_root=str(root))

    def test_default_50_per_volume(self, tmp_path: Path):
        eng = self._engine(tmp_path)
        assert eng.volume_for_chapter(1) == 1
        assert eng.volume_for_chapter(50) == 1
        assert eng.volume_for_chapter(51) == 2
        assert eng.volume_for_chapter(100) == 2
        assert eng.volume_for_chapter(101) == 3

    def test_zero_or_negative_clamped(self, tmp_path: Path):
        eng = self._engine(tmp_path)
        assert eng.volume_for_chapter(0) == 1

    def test_uses_state_volume_plan(self, tmp_path: Path):
        """state.json 里有卷规划时应优先采用。"""
        (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
        (tmp_path / ".webnovel" / "state.json").write_text(
            '{"progress": {"volumes": ['
            '{"volume": 1, "chapters_range": "1-30"},'
            '{"volume": 2, "chapters_range": "31-70"}]}}',
            encoding="utf-8")
        eng = self._engine(tmp_path)
        assert eng.volume_for_chapter(30) == 1
        assert eng.volume_for_chapter(31) == 2
        assert eng.volume_for_chapter(70) == 2


class TestRangeParsing:
    @pytest.mark.parametrize("raw,expected", [
        ("1-50", (1, 50)), ("31-70", (31, 70)), (" 5 - 9 ", (5, 9)),
    ])
    def test_valid(self, raw, expected):
        assert Engine._parse_range(raw) == expected

    @pytest.mark.parametrize("raw", ["", "abc", "50-1", "1", None, "1-"])
    def test_invalid(self, raw):
        assert Engine._parse_range(raw) is None


class TestResolveGenre:
    """题材必须解析出来：上游 story-system 的题材路由是硬匹配。"""

    def _engine(self, root: Path) -> Engine:
        from service.config import Settings
        s = Settings()
        s.llm.base_url = "http://x/v1"
        s.llm.model = "m"
        return Engine(s, project_root=str(root))

    def _write_state(self, root: Path, payload: dict) -> None:
        import json
        (root / ".webnovel").mkdir(parents=True, exist_ok=True)
        (root / ".webnovel" / "state.json").write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def test_from_project_info(self, tmp_path: Path):
        self._write_state(tmp_path, {"project_info": {"genre": "玄幻"}})
        assert self._engine(tmp_path).resolve_genre() == "玄幻"

    def test_from_project_key(self, tmp_path: Path):
        self._write_state(tmp_path, {"project": {"genre": "仙侠"}})
        assert self._engine(tmp_path).resolve_genre() == "仙侠"

    def test_from_top_level(self, tmp_path: Path):
        self._write_state(tmp_path, {"genre": "规则怪谈"})
        assert self._engine(tmp_path).resolve_genre() == "规则怪谈"

    def test_from_nested_dict(self, tmp_path: Path):
        self._write_state(tmp_path, {"project_info": {"genre": {"primary_genre": "都市"}}})
        assert self._engine(tmp_path).resolve_genre() == "都市"

    def test_missing_state_returns_empty(self, tmp_path: Path):
        assert self._engine(tmp_path).resolve_genre() == ""

    def test_corrupt_state_returns_empty(self, tmp_path: Path):
        (tmp_path / ".webnovel").mkdir(parents=True, exist_ok=True)
        (tmp_path / ".webnovel" / "state.json").write_text("{bad", encoding="utf-8")
        assert self._engine(tmp_path).resolve_genre() == ""

    def test_empty_genre_returns_empty(self, tmp_path: Path):
        self._write_state(tmp_path, {"project_info": {"genre": "  "}})
        assert self._engine(tmp_path).resolve_genre() == ""
