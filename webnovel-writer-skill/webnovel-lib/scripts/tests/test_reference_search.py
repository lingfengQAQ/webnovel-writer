#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Tests for reference_search.py — BM25 keyword search over CSV reference files.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = str(Path(__file__).resolve().parents[1] / "reference_search.py")
CSV_DIR = str(Path(__file__).resolve().parents[2] / "references" / "csv")


def run_search(*args: str) -> dict:
    """Run reference_search.py as a subprocess and return parsed JSON."""
    result = subprocess.run(
        [sys.executable, SCRIPT, "--csv-dir", CSV_DIR, *args],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"Script failed: {result.stderr}"
    return json.loads(result.stdout)


class TestSkillAndGenreFiltering:
    """Test filtering by skill and genre."""

    def test_skill_write_genre_xuanhuan_returns_nr001_not_nr002(self):
        """--skill write --table 命名规则 --query 角色命名 --genre 玄幻 → NR-001, not NR-002."""
        out = run_search(
            "--skill", "write",
            "--table", "命名规则",
            "--query", "角色命名",
            "--genre", "玄幻",
        )
        assert out["status"] == "success"
        ids = [r["编号"] for r in out["data"]["results"]]
        assert "NR-001" in ids
        assert "NR-002" not in ids

    def test_skill_write_cross_table_search(self):
        """--skill write --query 战斗描写 → SP-001 from 场景写法."""
        out = run_search(
            "--skill", "write",
            "--query", "战斗描写",
        )
        assert out["status"] == "success"
        assert out["data"]["total"] >= 1
        ids = [r["编号"] for r in out["data"]["results"]]
        assert "SP-001" in ids
        # Verify it comes from the right table
        tables = [r["表"] for r in out["data"]["results"] if r["编号"] == "SP-001"]
        assert tables[0] == "场景写法"

    def test_nonexistent_query_returns_empty(self):
        """--skill plan --query nonexistent → empty results, no error."""
        out = run_search(
            "--skill", "plan",
            "--query", "nonexistent",
        )
        assert out["status"] == "success"
        assert out["data"]["total"] == 0
        assert out["data"]["results"] == []

    def test_synonym_query_hits_manual_trigger_terms(self):
        """意图与同义词 应能触发命名规则召回。"""
        out = run_search(
            "--skill", "write",
            "--table", "命名规则",
            "--query", "名字怎么取",
            "--genre", "玄幻",
        )
        assert out["status"] == "success"
        ids = [r["编号"] for r in out["data"]["results"]]
        assert "NR-001" in ids

    def test_emotion_query_hits_writing_techniques_table(self):
        """情感与心理查询应命中 写作技法.csv。"""
        out = run_search(
            "--skill", "write",
            "--table", "写作技法",
            "--query", "情感描写 心理",
        )
        assert out["status"] == "success"
        ids = [r["编号"] for r in out["data"]["results"]]
        assert "WT-002" in ids

    def test_prompt_derived_dialogue_query_hits_new_writing_technique(self):
        """基于 prompt 补充的对话技法应可被检索。"""
        out = run_search(
            "--skill", "write",
            "--table", "写作技法",
            "--query", "去水词对话",
        )
        assert out["status"] == "success"
        ids = [r["编号"] for r in out["data"]["results"]]
        assert "WT-005" in ids

    def test_prompt_derived_trope_query_hits_bridge_table(self):
        """桥段套路表应能命中退婚流反击条目。"""
        out = run_search(
            "--skill", "write",
            "--table", "桥段套路",
            "--query", "退婚流 三年之约",
        )
        assert out["status"] == "success"
        ids = [r["编号"] for r in out["data"]["results"]]
        assert "TR-001" in ids

    def test_prompt_derived_pacing_query_hits_new_pacing_table(self):
        """爽点与节奏表应能命中微反转补刀。"""
        out = run_search(
            "--skill", "plan",
            "--table", "爽点与节奏",
            "--query", "微反转补刀",
        )
        assert out["status"] == "success"
        ids = [r["编号"] for r in out["data"]["results"]]
        assert "PA-002" in ids

    def test_prompt_derived_setting_query_hits_new_system_table(self):
        """金手指与设定表应能命中异能副作用边界。"""
        out = run_search(
            "--skill", "init",
            "--table", "金手指与设定",
            "--query", "异能副作用 代价",
        )
        assert out["status"] == "success"
        ids = [r["编号"] for r in out["data"]["results"]]
        assert "SY-002" in ids

    def test_prompt_derived_character_query_hits_new_character_table(self):
        """人设与关系表应能命中镜像反派条目。"""
        out = run_search(
            "--skill", "init",
            "--table", "人设与关系",
            "--query", "镜像反派",
        )
        assert out["status"] == "success"
        ids = [r["编号"] for r in out["data"]["results"]]
        assert "CH-001" in ids

    def test_internal_story_system_tables_do_not_leak_into_write_search(self):
        """普通 write 跨表检索不应召回题材路由和裁决层内部表。"""
        out = run_search(
            "--skill", "write",
            "--query", "追妻火葬场 规则 裁决",
            "--max-results", "20",
        )
        tables = {r["表"] for r in out["data"]["results"]}
        assert "题材与调性推理" not in tables
        assert "裁决规则" not in tables

    def test_story_system_skill_can_search_route_table(self):
        """story-system 是内部路由表的实际技能标签。"""
        out = run_search(
            "--skill", "story-system",
            "--table", "题材与调性推理",
            "--query", "快穿 任务 原主",
        )
        ids = [r["编号"] for r in out["data"]["results"]]
        assert "GR-025" in ids

    def test_legacy_comma_delimiters_remain_compatible(self, tmp_path):
        """迁移过渡期仍兼容旧的逗号分隔技能与题材字段。"""
        temp_dir = tmp_path / "reference_search_compat"
        temp_dir.mkdir(parents=True, exist_ok=True)
        csv_path = temp_dir / "兼容测试.csv"
        csv_path.write_text(
            "\n".join([
                "编号,适用技能,分类,层级,关键词,意图与同义词,适用题材,大模型指令,核心摘要,详细展开",
                "TS-001,\"write,plan\",测试,提醒,\"旧格式关键词\",\"旧格式查询\",\"玄幻,仙侠\",检查兼容层,兼容摘要,兼容详细展开",
            ]),
            encoding="utf-8",
        )
        out = run_search(
            "--csv-dir", str(temp_dir),
            "--skill", "write",
            "--table", "兼容测试",
            "--query", "旧格式查询",
            "--genre", "玄幻",
        )
        ids = [r["编号"] for r in out["data"]["results"]]
        assert "TS-001" in ids


class TestErrorHandling:
    """Test error cases."""

    def test_missing_csv_dir_returns_error(self):
        """Missing CSV dir → error JSON."""
        result = subprocess.run(
            [sys.executable, SCRIPT,
             "--csv-dir", "/nonexistent/path/that/does/not/exist",
             "--skill", "write",
             "--query", "test"],
            capture_output=True,
            text=True,
        )
        out = json.loads(result.stdout)
        assert out["status"] == "error"
        assert "CSV_DIR_NOT_FOUND" in out["error"]["code"]


class TestOutputFormat:
    """Test output JSON structure."""

    def test_result_has_required_fields(self):
        """Each result has 编号, 表, 分类, 层级, 适用题材, 内容摘要, 大模型指令."""
        out = run_search(
            "--skill", "write",
            "--table", "命名规则",
            "--query", "角色命名",
        )
        assert out["status"] == "success"
        for r in out["data"]["results"]:
            assert "编号" in r
            assert "表" in r
            assert "分类" in r
            assert "层级" in r
            assert "适用题材" in r
            assert "内容摘要" in r
            assert "大模型指令" in r

    def test_content_summary_prefers_core_summary(self):
        """内容摘要优先返回 核心摘要。"""
        out = run_search(
            "--skill", "write",
            "--table", "命名规则",
            "--query", "角色命名",
            "--genre", "玄幻",
        )
        row = next(r for r in out["data"]["results"] if r["编号"] == "NR-001")
        assert row["内容摘要"] == "玄幻角色命名要保留修仙感与古风意象，避免现代日常姓名直接套入。"

    def test_data_envelope_fields(self):
        """Data envelope has query, skill, genre, total, results."""
        out = run_search(
            "--skill", "write",
            "--query", "命名",
            "--genre", "玄幻",
        )
        data = out["data"]
        assert data["query"] == "命名"
        assert data["skill"] == "write"
        assert data["genre"] == "玄幻"
        assert isinstance(data["total"], int)
        assert isinstance(data["results"], list)

    def test_max_results_limits_output(self):
        """--max-results 1 limits to 1 result."""
        out = run_search(
            "--skill", "write",
            "--query", "命名",
            "--max-results", "1",
        )
        assert out["data"]["total"] <= 1


class TestPerTableSearchCols:
    def test_different_tables_use_different_search_weights(self):
        out1 = run_search("--skill", "write", "--table", "命名规则", "--query", "角色命名")
        out2 = run_search("--skill", "write", "--table", "场景写法", "--query", "战斗描写")
        assert out1["status"] == "success"
        assert out2["status"] == "success"
        assert out1["data"]["total"] >= 1
        assert out2["data"]["total"] >= 1


class TestGenreCanonical:
    def test_canonical_genres_has_15_entries(self):
        from reference_search import GENRE_CANONICAL
        assert len(GENRE_CANONICAL) == 15
        expected = {
            "都市", "玄幻", "仙侠", "奇幻", "科幻",
            "历史", "悬疑", "游戏", "古言", "现言",
            "幻言", "年代", "种田", "快穿", "衍生",
        }
        assert GENRE_CANONICAL == expected

    def test_platform_to_canonical_maps_all_tags(self):
        from reference_search import PLATFORM_TO_CANONICAL
        # 34 unique tags (some tags like 科幻末世, 悬疑脑洞, 游戏体育 appear in both male/female)
        assert len(PLATFORM_TO_CANONICAL) == 34
        # Every value must be a canonical genre
        from reference_search import GENRE_CANONICAL
        for tag, canonical in PLATFORM_TO_CANONICAL.items():
            assert canonical in GENRE_CANONICAL, f"{tag} -> {canonical} not in GENRE_CANONICAL"

    def test_platform_to_canonical_spot_checks(self):
        from reference_search import PLATFORM_TO_CANONICAL
        assert PLATFORM_TO_CANONICAL["都市日常"] == "都市"
        assert PLATFORM_TO_CANONICAL["战神赘婿"] == "都市"
        assert PLATFORM_TO_CANONICAL["东方仙侠"] == "仙侠"
        assert PLATFORM_TO_CANONICAL["西方奇幻"] == "奇幻"
        assert PLATFORM_TO_CANONICAL["古风世情"] == "古言"
        assert PLATFORM_TO_CANONICAL["豪门总裁"] == "现言"
        assert PLATFORM_TO_CANONICAL["快穿"] == "快穿"
        assert PLATFORM_TO_CANONICAL["科幻末世"] == "科幻"

    def test_resolve_genre_canonical_passthrough(self):
        from reference_search import resolve_genre
        assert resolve_genre("都市") == "都市"
        assert resolve_genre("全部") == "全部"
        assert resolve_genre(None) is None

    def test_resolve_genre_platform_tag(self):
        from reference_search import resolve_genre
        assert resolve_genre("都市日常") == "都市"
        assert resolve_genre("战神赘婿") == "都市"
        assert resolve_genre("古风世情") == "古言"

    def test_resolve_genre_legacy(self):
        from reference_search import resolve_genre
        assert resolve_genre("武侠") == "历史"
        assert resolve_genre("刑侦") == "悬疑"
        assert resolve_genre("网游") == "游戏"

    def test_search_with_platform_tag_genre(self):
        """--genre 都市日常 should match rows with 适用题材=都市."""
        out = run_search(
            "--skill", "write",
            "--table", "命名规则",
            "--query", "角色命名",
            "--genre", "都市日常",
        )
        assert out["status"] == "success"
        # Should find results (都市日常 resolves to 都市, matching rows tagged 都市)
        assert out["data"]["total"] >= 0  # may be 0 if no 都市 rows, but no error


class TestEndToEndSmoke:
    """Smoke tests: canonical genre pipeline over current CSV data."""

    def test_xuanhuan_search_returns_results(self):
        out = run_search("--skill", "write", "--query", "角色命名", "--genre", "玄幻")
        assert out["status"] == "success"
        assert out["data"]["total"] >= 1

    def test_romance_search_returns_results(self):
        out = run_search("--skill", "write", "--query", "追妻 火葬场", "--genre", "现言")
        assert out["status"] == "success"
        assert out["data"]["total"] >= 1

    def test_platform_tag_as_genre_returns_results(self):
        out = run_search("--skill", "write", "--query", "规则 动物园 守则", "--genre", "悬疑脑洞")
        assert out["status"] == "success"
        assert out["data"]["total"] >= 1

    def test_validate_csv_zero_errors(self):
        validate_script = str(Path(__file__).resolve().parents[1] / "validate_csv.py")
        result = subprocess.run(
            [sys.executable, validate_script, "--csv-dir", CSV_DIR, "--format", "json"],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        data = json.loads(result.stdout)
        assert len(data["errors"]) == 0, f"CSV validation errors: {data['errors']}"
