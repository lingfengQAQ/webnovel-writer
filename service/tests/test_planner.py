# -*- coding: utf-8 -*-
"""规划 pipeline 测试。

覆盖修过的真实缺口：新项目 init 后只有总纲、零章纲，
而写章第一步就要从章纲解析目标 —— 缺这一步 init → write 走不通。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from service.planner import PlanPipeline, PlanResult
from conftest import FakeEngine, FakeLLM, make_settings

VOLUME_JSON = {
    "volume_beats": "# 卷节拍表\n\n**中段反转**：主角身份揭穿\n危机链：3 次递增\n",
    "volume_timeline": "# 卷时间线\n\n时间体系：纪年\n跨度：三个月\nD-1 至 D-90\n",
}


def chapters_json(nums, *, with_cen=True):
    return {
        "chapters": [
            {
                "chapter": n,
                "title": f"第{n}章标题",
                "goal": f"第{n}章目标",
                "content": (
                    f"### 第{n}章：第{n}章标题\n\n"
                    f"**目标**：第{n}章目标\n"
                    f"**阻力**：阻力\n**代价**：代价\n"
                    f"**时间锚点**：第{n}日\n**章内时间跨度**：一日\n"
                    f"**与上章时间差**：一日\n**倒计时状态**：无\n"
                    f"**爽点**：C级\n**Strand**：主线\n**反派层级**：小反派\n"
                    f"**视角/主角**：主角\n**关键实体**：主角\n"
                    f"**本章变化**：变化\n**章末未闭合问题**：悬念\n**钩子**：钩子\n\n"
                    f"**CBN**：主角 | 进入 | 场景{n}\n"
                    f"**CPNs**：\n- 主角 | 做 | 事\n- 主角 | 遇 | 阻\n"
                    + (f"**CEN**：主角 | 结束 | 场景{n}\n" if with_cen else "")
                    + "**必须覆盖节点**：\n- 主角 | 完成 | 目标\n"
                    f"**本章禁区**：\n- 禁止提前揭露真相\n"
                ),
            }
            for n in nums
        ]
    }


def make_planner(project: Path, *, volume_llm=None, chapters_llm=None, **kwargs):
    eng = FakeEngine(project)
    clients = {
        "draft": FakeLLM("draft", json_value=VOLUME_JSON),
    }
    if volume_llm is not None:
        clients["plan"] = volume_llm
    elif chapters_llm is not None:
        clients["plan"] = chapters_llm
    defaults = dict(volume=1, chapter_start=1, chapter_end=3, genre="玄幻",
                    batch_size=3)
    defaults.update(kwargs)
    return PlanPipeline(make_settings(), eng, clients, **defaults), eng


class TestPlanHappyPath:
    async def test_generates_all_three_files(self, project: Path):
        p, eng = make_planner(project)
        results = iter([VOLUME_JSON, chapters_json([1, 2, 3])])
        p._client = lambda role: FakeLLM("plan", json_value=next(results))

        r = await p.run()
        assert r.status == "completed", r.problems
        assert Path(r.beats_file).is_file()
        assert Path(r.timeline_file).is_file()
        assert Path(r.outline_file).is_file()
        assert r.chapters_planned == [1, 2, 3]

    async def test_outline_readable_by_engine_after_plan(self, project: Path):
        """关键：规划后章纲必须能被 chapter_outline 读到，否则写章仍失败。"""
        p, eng = make_planner(project)
        results = iter([VOLUME_JSON, chapters_json([1, 2, 3])])
        p._client = lambda role: FakeLLM("plan", json_value=next(results))
        await p.run()

        outline_file = project / "大纲" / "第1卷-详细大纲.md"
        assert outline_file.is_file()
        # 用真实 Engine 的解析逻辑验证（而非 FakeEngine）
        from service.engine import Engine
        s = make_settings()
        real = Engine(s, project_root=str(project))
        out = real.chapter_outline(1)
        assert out is not None
        assert "第1章目标" in out

    async def test_chapter_sections_separated(self, project: Path):
        p, eng = make_planner(project)
        results = iter([VOLUME_JSON, chapters_json([1, 2, 3])])
        p._client = lambda role: FakeLLM("plan", json_value=next(results))
        await p.run()

        from service.engine import Engine
        real = Engine(make_settings(), project_root=str(project))
        s1 = real.chapter_outline(1)
        s2 = real.chapter_outline(2)
        assert "第1章目标" in s1 and "第2章目标" not in s1
        assert "第2章目标" in s2

    async def test_refreshes_story_contract(self, project: Path):
        p, eng = make_planner(project)
        results = iter([VOLUME_JSON, chapters_json([1, 2, 3])])
        p._client = lambda role: FakeLLM("plan", json_value=next(results))
        await p.run()
        assert "story_system" in eng.calls


class TestIncrementalPlanning:
    """增量补齐：已存在的章节不应被重写。"""

    async def test_existing_sections_preserved(self, project: Path):
        outline = project / "大纲" / "第1卷-详细大纲.md"
        outline.parent.mkdir(parents=True, exist_ok=True)
        outline.write_text(
            "### 第1章：旧标题\n\n**目标**：旧目标，必须保留\n", encoding="utf-8")

        p, eng = make_planner(project, chapter_end=2)
        results = iter([VOLUME_JSON, chapters_json([2])])
        p._client = lambda role: FakeLLM("plan", json_value=next(results))
        r = await p.run()

        text = outline.read_text(encoding="utf-8")
        assert "旧目标，必须保留" in text, "已存在的章纲被覆盖了"
        assert "第2章目标" in text

    async def test_all_present_skips_generation(self, project: Path):
        outline = project / "大纲" / "第1卷-详细大纲.md"
        outline.parent.mkdir(parents=True, exist_ok=True)
        outline.write_text(
            "### 第1章：a\n\n**目标**：a\n### 第2章：b\n\n**目标**：b\n",
            encoding="utf-8")
        p, eng = make_planner(project, chapter_end=2)
        r = await p.run()
        assert r.status == "completed"
        assert any("已存在" in m for m in r.auto_handled)


class TestBatching:
    async def test_batches_respect_batch_size(self, project: Path):
        """5 章 / 每批 2 章 → 3 个章纲批次（外加 1 次卷规划）。"""
        p, eng = make_planner(project, chapter_end=5, batch_size=2)
        calls = {"n": 0}

        def fake_client(role):
            f = FakeLLM("plan", json_value=None)

            async def complete_json(*a, **kw):
                calls["n"] += 1
                if calls["n"] == 1:
                    return VOLUME_JSON
                if calls["n"] == 2:
                    return chapters_json([1, 2])
                if calls["n"] == 3:
                    return chapters_json([3, 4])
                return chapters_json([5])

            f.complete_json = complete_json
            return f

        p._client = fake_client
        r = await p.run()
        assert calls["n"] == 4, f"期望 1 卷 + 3 批（无重试），实际 {calls['n']}"
        assert r.chapters_planned == [1, 2, 3, 4, 5]
        assert r.status == "completed", r.problems

    async def test_failed_batch_does_not_abort_others(self, project: Path):
        """上游恢复规则：只重做失败批次，不放弃整卷。

        第一批持续失败（含重试全部失败），第二批仍应成功。
        """
        p, eng = make_planner(project, chapter_end=4, batch_size=2)
        state = {"n": 0}

        def fake_client(role):
            f = FakeLLM("plan", json_value=None)

            async def complete_json(*a, **kw):
                state["n"] += 1
                if state["n"] == 1:          # 卷规划
                    return VOLUME_JSON
                if state["n"] <= 1 + 2:      # 第一批 + 其重试，均失败
                    from service.llm import LLMError
                    raise LLMError("第一批故意失败")
                return chapters_json([3, 4])  # 第二批成功

            f.complete_json = complete_json
            return f

        p._client = fake_client
        r = await p.run()
        assert r.chapters_planned == [3, 4], "失败批次不应中断后续批次"
        assert any("1-2" in m for m in r.problems)


class TestRetryOnBadOutput:
    """模型偶发返回空结构或不按 schema —— 单次调用失败不该丢掉整批/整卷。"""

    async def test_chapter_batch_retried_on_empty_chapters(self, project: Path):
        p, eng = make_planner(project, chapter_end=1, batch_size=1)
        seq = [VOLUME_JSON, {"chapters": []}, chapters_json([1])]
        calls = {"n": 0}

        def fake_client(role):
            f = FakeLLM("plan", json_value=None)

            async def complete_json(*a, **kw):
                calls["n"] += 1
                return seq[min(calls["n"] - 1, len(seq) - 1)]

            f.complete_json = complete_json
            return f

        p._client = fake_client
        r = await p.run()
        assert r.chapters_planned == [1], f"重试后仍失败：{r.problems}"
        assert r.status == "completed"
        assert any("重试成功" in m for m in r.auto_handled)

    async def test_chapter_batch_retried_on_llm_error(self, project: Path):
        p, eng = make_planner(project, chapter_end=1, batch_size=1)
        seq = [VOLUME_JSON, chapters_json([1])]
        calls = {"n": 0}

        def fake_client(role):
            f = FakeLLM("plan", json_value=None)

            async def complete_json(*a, **kw):
                calls["n"] += 1
                if calls["n"] == 2:
                    from service.llm import LLMError
                    raise LLMError("网络抖动")
                return seq[min(calls["n"] - 1, len(seq) - 1)]

            f.complete_json = complete_json
            return f

        p._client = fake_client
        r = await p.run()
        assert r.chapters_planned == [1]
        assert any("重试成功" in m for m in r.auto_handled)

    async def test_gives_up_after_all_retries(self, project: Path):
        p, eng = make_planner(project, chapter_end=1, batch_size=1)
        p._client = lambda role: FakeLLM("plan", json_value={"chapters": []})
        r = await p.run()
        assert r.status == "failed"
        assert any("已重试" in m for m in r.problems)

    async def test_volume_retried_on_missing_keys(self, project: Path):
        p, eng = make_planner(project, chapter_end=1, batch_size=1)
        calls = {"n": 0}

        def fake_client(role):
            f = FakeLLM("plan", json_value=None)

            async def complete_json(*a, **kw):
                calls["n"] += 1
                if calls["n"] == 1:
                    return {"volume_beats": "只有节拍"}   # 缺 timeline → 触发重试
                if calls["n"] == 2:
                    return VOLUME_JSON
                return chapters_json([1])

            f.complete_json = complete_json
            return f

        p._client = fake_client
        r = await p.run()
        assert r.status == "completed", r.problems
        assert any("卷规划" in m and "重试成功" in m for m in r.auto_handled)

    async def test_volume_gives_up_after_retries(self, project: Path):
        p, eng = make_planner(project)
        p._client = lambda role: FakeLLM("plan", json_value={"volume_beats": "x"})
        r = await p.run()
        assert r.status == "failed"
        assert any("卷规划失败" in m for m in r.problems)


class TestPlanFailures:
    async def test_missing_genre_fails(self, project: Path):
        p, eng = make_planner(project, genre="")
        eng.genre = ""
        r = await p.run()
        assert r.status == "failed"
        assert any("题材" in m for m in r.problems)

    async def test_preflight_failure_fails(self, project: Path):
        p, eng = make_planner(project)
        eng.preflight_ok = False
        r = await p.run()
        assert r.status == "failed"

    async def test_missing_volume_content_fails(self, project: Path):
        p, eng = make_planner(project)
        p._client = lambda role: FakeLLM("plan", json_value={"volume_beats": "只有节拍"})
        r = await p.run()
        assert r.status == "failed"
        assert any("volume_timeline" in m for m in r.problems)

    async def test_no_chapters_generated_fails(self, project: Path):
        p, eng = make_planner(project)
        results = iter([VOLUME_JSON, {"chapters": []}])
        p._client = lambda role: FakeLLM("plan", json_value=next(results))
        r = await p.run()
        assert r.status == "failed"
        assert any("章纲" in m for m in r.problems)

    async def test_llm_failure_reports(self, project: Path):
        p, eng = make_planner(project)
        p._client = lambda role: FakeLLM("plan", fail=True)
        r = await p.run()
        assert r.status == "failed"

    async def test_missing_mid_volume_twist_noted(self, project: Path):
        p, eng = make_planner(project)
        beats = {"volume_beats": "# 无反转字段", "volume_timeline": "# 时间线"}
        results = iter([beats, chapters_json([1, 2, 3])])
        p._client = lambda role: FakeLLM("plan", json_value=next(results))
        r = await p.run()
        assert any("中段反转" in m for m in r.problems)


class TestStatusClassification:
    """回归：planner 初始 status=failed 曾导致成功也报 failed。"""

    async def test_success_is_completed_not_failed(self, project: Path):
        p, eng = make_planner(project)
        results = iter([VOLUME_JSON, chapters_json([1, 2, 3])])
        p._client = lambda role: FakeLLM("plan", json_value=next(results))
        r = await p.run()
        assert r.status == "completed", f"成功却报 {r.status}: {r.problems}"

    async def test_partial_when_some_chapters_missing(self, project: Path):
        p, eng = make_planner(project, chapter_end=3)
        results = iter([VOLUME_JSON, chapters_json([1, 2])])
        p._client = lambda role: FakeLLM("plan", json_value=next(results))
        r = await p.run()
        assert r.status == "partial"
        assert any("未生成" in m for m in r.problems)

    async def test_result_serializable(self, project: Path):
        p, eng = make_planner(project)
        results = iter([VOLUME_JSON, chapters_json([1, 2, 3])])
        p._client = lambda role: FakeLLM("plan", json_value=next(results))
        r = await p.run()
        assert json.loads(json.dumps(r.to_dict(), ensure_ascii=False))


class TestSectionSplitting:
    def test_splits_arabic_and_chinese(self):
        text = ("### 第1章：一\n内容A\n### 第2章：二\n内容B\n"
                "### 第十章：十\n内容C\n")
        got = PlanPipeline._split_sections(text)
        assert sorted(got) == [1, 2, 10]
        assert "内容A" in got[1]
        assert "内容B" not in got[1]

    def test_empty_text(self):
        assert PlanPipeline._split_sections("") == {}

    def test_no_headings(self):
        assert PlanPipeline._split_sections("没有标题") == {}
