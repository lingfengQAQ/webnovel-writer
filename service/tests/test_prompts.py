# -*- coding: utf-8 -*-
"""提示词测试：schema 契约不能漂移。

这些断言看起来琐碎，但上游 chapter-commit 会按 schema 拒收，
提示词里少一个字段就可能导致整章提交失败。
"""

from __future__ import annotations

import pytest

from service import prompts


class TestContextPrompt:
    def test_requires_five_sections(self):
        assert "五段" in prompts.CONTEXT_SYSTEM

    def test_data_weight_order_stated(self):
        assert "数据权重" in prompts.CONTEXT_SYSTEM

    def test_embeds_chapter_and_pack(self):
        p = prompts.build_context_prompt(7, {"k": "v"}, "章纲内容")
        assert "第 7 章" in p
        assert "章纲内容" in p

    def test_handles_missing_outline(self):
        p = prompts.build_context_prompt(7, None, None)
        assert "未找到章纲文件" in p

    def test_blocker_instruction_present(self):
        p = prompts.build_context_prompt(1, None, None)
        assert "BLOCKER" in p


class TestDraftPrompt:
    def test_forbids_placeholders(self):
        assert "占位符" in prompts.DRAFT_SYSTEM

    def test_includes_feedback_when_retrying(self):
        p = prompts.build_draft_prompt(1, "任务书", feedback="上一稿过短")
        assert "上一稿过短" in p
        assert "必须修正" in p

    def test_includes_target_words(self):
        p = prompts.build_draft_prompt(1, "任务书", target_words=2500)
        assert "2500" in p


class TestReviewPrompt:
    def test_declares_exactly_five_dimensions(self):
        assert prompts.REVIEW_SYSTEM.count("（category:") == 5

    @pytest.mark.parametrize("dim", ["setting", "timeline", "continuity",
                                     "character", "logic"])
    def test_each_dimension_documented(self, dim):
        assert dim in prompts.REVIEW_SYSTEM

    def test_requires_dimension_results(self):
        assert "dimension_results" in prompts.REVIEW_SYSTEM

    def test_forbids_scoring(self):
        assert "不评分" in prompts.REVIEW_SYSTEM

    def test_forbids_style_judgement(self):
        assert "不评价文笔质量" in prompts.REVIEW_SYSTEM

    def test_schema_fields_present(self):
        for field in ("issues_count", "blocking_count", "has_blocking",
                      "severity", "evidence", "fix_hint"):
            assert field in prompts.REVIEW_SYSTEM, f"缺字段 {field}"

    def test_prompt_embeds_text_and_context(self):
        p = prompts.build_review_prompt(3, "正文内容", {"c": 1})
        assert "正文内容" in p
        assert "第 3 章" in p


class TestDataPrompt:
    def test_lists_all_event_types(self):
        for et in ("character_state_changed", "power_breakthrough",
                   "relationship_changed", "world_rule_revealed",
                   "world_rule_broken", "open_loop_created", "open_loop_closed",
                   "promise_created", "promise_paid_off", "artifact_obtained"):
            assert et in prompts.DATA_SYSTEM, f"缺 event_type {et}"

    def test_forbids_nesting_extraction(self):
        assert "禁止包在外层对象里" in prompts.DATA_SYSTEM

    def test_lists_required_extraction_keys(self):
        for key in ("accepted_events", "state_deltas", "entity_deltas",
                    "entities_appeared", "scenes", "summary_text"):
            assert key in prompts.DATA_SYSTEM, f"缺 {key}"

    def test_requires_english_entity_ids(self):
        assert "非中文名" in prompts.DATA_SYSTEM

    def test_three_artifact_wrapper(self):
        for key in ("fulfillment_result", "disambiguation_result",
                    "extraction_result"):
            assert key in prompts.DATA_SYSTEM

    def test_entity_type_enum(self):
        assert "角色|组织|地点|物品|势力" in prompts.DATA_SYSTEM

    def test_prompt_embeds_text(self):
        p = prompts.build_data_prompt(5, "章节正文", {"e": 1})
        assert "章节正文" in p
        assert "第 5 章" in p


class TestPolishPrompt:
    def test_has_seven_anti_ai_layers(self):
        assert "7 层" in prompts.POLISH_SYSTEM

    def test_forbids_fact_changes(self):
        assert "只改表达，不改事实" in prompts.POLISH_SYSTEM

    def test_execution_order_present(self):
        assert "执行顺序" in prompts.POLISH_SYSTEM

    def test_prompt_includes_issues(self):
        p = prompts.build_polish_prompt(1, "正文", [{"description": "问题"}])
        assert "问题" in p


class TestPlanPrompts:
    def test_volume_requires_mid_twist(self):
        assert "中段反转" in prompts.PLAN_VOLUME_SYSTEM

    def test_volume_requires_timeline(self):
        assert "时间线" in prompts.PLAN_VOLUME_SYSTEM

    def test_volume_output_keys(self):
        assert "volume_beats" in prompts.PLAN_VOLUME_SYSTEM
        assert "volume_timeline" in prompts.PLAN_VOLUME_SYSTEM

    def test_chapters_defines_nodes(self):
        for node in ("CBN", "CPNs", "CEN", "必须覆盖节点", "本章禁区"):
            assert node in prompts.PLAN_CHAPTERS_SYSTEM, f"缺节点定义 {node}"

    def test_chapters_caps_counts(self):
        assert "2-4" in prompts.PLAN_CHAPTERS_SYSTEM   # CPNs
        assert "不超过 5 条" in prompts.PLAN_CHAPTERS_SYSTEM  # 禁区
        assert "最多 4 个" in prompts.PLAN_CHAPTERS_SYSTEM    # 必须覆盖

    def test_chapters_requires_time_fields(self):
        assert "时间锚点" in prompts.PLAN_CHAPTERS_SYSTEM

    def test_chapters_requires_adjacency(self):
        assert "承接" in prompts.PLAN_CHAPTERS_SYSTEM

    def test_volume_prompt_embeds_range(self):
        p = prompts.build_plan_volume_prompt(1, 1, 50, "总纲", {}, "玄幻")
        assert "第 1-50 章" in p
        assert "玄幻" in p

    def test_chapters_prompt_embeds_batch(self):
        p = prompts.build_plan_chapters_prompt(
            1, 1, 50, "节拍", "时间线", "玄幻", 11, 20, "上一章CEN")
        assert "11-20" in p
        assert "上一章CEN" in p


class TestDumpTruncation:
    def test_truncates_long_text(self):
        out = prompts._dump("字" * 50000, 1000)
        assert len(out) < 2000
        assert "已截断" in out

    def test_none_renders_placeholder(self):
        assert prompts._dump(None) == "(无)"

    def test_dict_renders_json(self):
        out = prompts._dump({"a": 1})
        assert '"a": 1' in out

    def test_string_passthrough(self):
        assert prompts._dump("hello", 100) == "hello"
