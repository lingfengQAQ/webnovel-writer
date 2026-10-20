# -*- coding: utf-8 -*-
"""写章 pipeline 测试。

重点覆盖修过的两个真实 bug：
1. 阻断问题是死路 —— 停在 needs_user_action 后无路可走
2. 状态判定错误 —— 成功也报 failed / 失败也报 completed
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from service.pipeline import Stage, WritePipeline, WriteResult
from conftest import (
    FakeEngine,
    FakeLLM,
    build_clients,
    data_payload,
    make_settings,
    review_payload,
)


def make_pipeline(project: Path, clients=None, engine=None, **kwargs) -> WritePipeline:
    eng = engine or FakeEngine(project, outline="### 第1章：测试章\n**目标**：测试目标\n")
    cls = clients if clients is not None else build_clients()
    defaults = dict(chapter_title="测试章", genre="玄幻")
    defaults.update(kwargs)
    return WritePipeline(make_settings(), eng, cls, **defaults)


class TestHappyPath:
    async def test_full_run_completes(self, project: Path):
        p = make_pipeline(project)
        r = await p.run(1)
        assert r.status == "completed", r.problems
        assert r.chapter_file
        assert r.commit_file
        assert r.backup_status == "done"

    async def test_all_stages_executed(self, project: Path):
        eng = FakeEngine(project, outline="### 第1章：x\n**目标**：y")
        p = make_pipeline(project, engine=eng)
        await p.run(1)
        for expected in ("preflight", "story_system", "load_context",
                         "write_chapter_file", "review_pipeline",
                         "chapter_commit", "backup"):
            assert expected in eng.calls, f"缺少阶段调用: {expected}"

    async def test_chapter_file_written_to_disk(self, project: Path):
        p = make_pipeline(project)
        r = await p.run(1)
        content = Path(r.chapter_file).read_text(encoding="utf-8")
        assert len(content) > 300

    async def test_timings_recorded(self, project: Path):
        p = make_pipeline(project)
        r = await p.run(1)
        assert "draft" in r.timings
        assert "review" in r.timings

    async def test_projection_status_captured(self, project: Path):
        p = make_pipeline(project)
        r = await p.run(1)
        assert r.projection_status.get("state") == "done"


class TestBlockingDeadEnd:
    """回归测试：阻断问题必须既能停下、又能继续。"""

    async def test_stops_when_blocking_and_not_accepted(self, project: Path):
        clients = build_clients(review=FakeLLM("review", json_value=review_payload(True)))
        p = make_pipeline(project, clients=clients)
        r = await p.run(1)
        assert r.status == "needs_user_action"
        assert len(r.blocking_issues) == 1
        assert not r.commit_file  # 不应提交
        assert any("阻断" in m for m in r.needs_user_action)

    async def test_writes_blocking_state_file_with_options(self, project: Path):
        clients = build_clients(review=FakeLLM("review", json_value=review_payload(True)))
        eng = FakeEngine(project, outline="### 第1章：x\n**目标**：y")
        p = make_pipeline(project, clients=clients, engine=eng)
        await p.run(1)
        bf = eng.tmp_dir() / "blocking_state.json"
        assert bf.is_file(), "阻断状态未落盘，用户无从查看"
        state = json.loads(bf.read_text(encoding="utf-8"))
        assert len(state["blocking_issues"]) == 1
        assert len(state["resume_options"]) >= 2
        stages = {o["from_stage"] for o in state["resume_options"]}
        assert "polish" in stages and "draft" in stages

    async def test_adjudication_written_into_artifact(self, project: Path):
        """关键：裁决必须写进 review_results.json。

        上游 precommit gate 直接读该文件的 blocking_count，只设内存标志位
        会被 gate 拒绝 —— 这是"死路没修好"的真正原因。
        """
        clients = build_clients(review=FakeLLM("review", json_value=review_payload(True)))
        eng = FakeEngine(project, outline="### 第1章：x\n**目标**：y")
        p = make_pipeline(project, clients=clients, engine=eng, accept_blocking=True)
        r = await p.run(1)

        artifact = json.loads(
            (eng.tmp_dir() / "review_results.json").read_text(encoding="utf-8"))
        assert artifact["blocking_count"] == 0, "gate 仍会拒绝：blocking_count 未清零"
        assert artifact["has_blocking"] is False
        # 审计线索不能丢
        assert len(artifact["adjudicated_blocking_issues"]) == 1
        assert artifact["adjudication"]["original_blocking_count"] == 1
        assert artifact["adjudication"]["accepted_by"] == "service"
        assert r.commit_file, "接受阻断后仍应能提交"

    async def test_accept_blocking_still_commits(self, project: Path):
        clients = build_clients(review=FakeLLM("review", json_value=review_payload(True)))
        p = make_pipeline(project, clients=clients, accept_blocking=True)
        r = await p.run(1)
        assert r.status == "completed"
        assert r.commit_file

    async def test_non_blocking_issues_do_not_stop(self, project: Path):
        payload = review_payload(False)
        payload["issues"] = [{
            "severity": "low", "category": "logic", "location": "x",
            "description": "小问题", "evidence": "e", "fix_hint": "f",
            "blocking": False,
        }]
        payload["issues_count"] = 1
        clients = build_clients(review=FakeLLM("review", json_value=payload))
        p = make_pipeline(project, clients=clients)
        r = await p.run(1)
        assert r.status == "completed"

    async def test_resume_after_review_detects_unresolved_blocking(self, project: Path):
        """关键回归：从 review 之后续跑时，若 artifact 里仍有未裁决的阻断项，
        必须停下报 needs_user_action，而不是一路走到 commit 被 gate 拒绝后
        报成含糊的 failed（用户看不到裁决入口）。
        """
        # 先完整跑一次
        first = make_pipeline(project)
        await first.run(1)

        # 写入一个未裁决的阻断 artifact
        (project / ".webnovel" / "tmp" / "review_results.json").write_text(
            json.dumps(review_payload(True), ensure_ascii=False), encoding="utf-8")

        # 从 polish 续跑（不跑 review），应读到阻断并停下
        eng = FakeEngine(project)
        p = make_pipeline(project, engine=eng, accept_blocking=False)
        r = await p.run(1, from_stage="polish")
        assert r.status == "needs_user_action", \
            f"未裁决的阻断被放过去了：{r.status} {r.problems}"
        assert r.blocking_issues
        assert "review_pipeline" not in eng.calls, "从 polish 续跑不应重跑审查"

    async def test_resume_after_review_accepts_when_flagged(self, project: Path):
        """同一场景 + accept_blocking=True：应写入裁决并完成提交。"""
        first = make_pipeline(project)
        await first.run(1)
        (project / ".webnovel" / "tmp" / "review_results.json").write_text(
            json.dumps(review_payload(True), ensure_ascii=False), encoding="utf-8")

        p = make_pipeline(project, accept_blocking=True)
        r = await p.run(1, from_stage="polish")
        assert r.status == "completed", f"{r.status} {r.problems}"
        artifact = json.loads(
            (project / ".webnovel" / "tmp" / "review_results.json")
            .read_text(encoding="utf-8"))
        assert artifact["blocking_count"] == 0
        assert artifact["adjudicated_blocking_issues"]


class TestResume:
    """阶段续跑：每个 from_stage 都应有确定行为。"""

    async def test_resume_from_commit_skips_earlier_stages(self, project: Path):
        # 先完整跑一次产生正文与 artifact
        first = make_pipeline(project)
        await first.run(1)

        eng = FakeEngine(project)
        clients = build_clients()
        p = make_pipeline(project, clients=clients, engine=eng, accept_blocking=True)
        r = await p.run(1, from_stage="commit")

        assert r.commit_file
        assert "write_chapter_file" not in eng.calls, "从 commit 续跑不应重写正文"
        assert "review_pipeline" not in eng.calls, "从 commit 续跑不应重跑审查"

    async def test_resume_from_polish_reads_existing_text(self, project: Path):
        first = make_pipeline(project)
        await first.run(1)

        eng = FakeEngine(project)
        p = make_pipeline(project, clients=build_clients(), engine=eng)
        r = await p.run(1, from_stage="polish")
        assert r.chapter_file
        assert "preflight" not in eng.calls

    async def test_resume_notes_skip_in_auto_handled(self, project: Path):
        first = make_pipeline(project)
        await first.run(1)
        p = make_pipeline(project, accept_blocking=True)
        r = await p.run(1, from_stage="commit")
        assert any("续跑" in m for m in r.auto_handled)

    async def test_resume_without_chapter_file_fails_clearly(self, project: Path):
        p = make_pipeline(project, accept_blocking=True)
        r = await p.run(1, from_stage="commit")
        assert r.status == "failed"
        assert any("正文不存在" in m for m in r.problems)

    async def test_invalid_from_stage_falls_back_to_full(self, project: Path):
        eng = FakeEngine(project, outline="### 第1章：x\n**目标**：y")
        p = make_pipeline(project, engine=eng)
        r = await p.run(1, from_stage="不存在的阶段")
        assert r.status == "completed"
        assert "preflight" in eng.calls


class TestStatusClassification:
    """回归测试：状态判定不能假报成功，也不能误报失败。"""

    async def test_success_is_completed(self, project: Path):
        p = make_pipeline(project)
        assert (await p.run(1)).status == "completed"

    async def test_preflight_failure_is_failed(self, project: Path):
        eng = FakeEngine(project, preflight_ok=False)
        p = make_pipeline(project, engine=eng)
        r = await p.run(1)
        assert r.status == "failed"
        assert any("预检" in m for m in r.problems)

    async def test_placeholder_blocks_start(self, project: Path):
        eng = FakeEngine(project, placeholders=True)
        p = make_pipeline(project, engine=eng)
        r = await p.run(1)
        assert r.status == "failed"
        assert any("占位" in m for m in r.problems)

    async def test_missing_genre_fails_with_clear_message(self, project: Path):
        eng = FakeEngine(project, genre="", outline="### 第1章：x\n**目标**：y")
        p = make_pipeline(project, engine=eng, genre="")
        r = await p.run(1)
        assert r.status == "failed"
        assert any("题材" in m for m in r.problems)

    async def test_missing_outline_fails_with_clear_message(self, project: Path):
        eng = FakeEngine(project, outline=None)
        p = make_pipeline(project, engine=eng, chapter_goal="")
        r = await p.run(1)
        assert r.status == "failed"
        assert any("章纲" in m or "目标" in m for m in r.problems)

    async def test_llm_failure_is_failed(self, project: Path):
        clients = build_clients(draft=FakeLLM("draft", fail=True))
        p = make_pipeline(project, clients=clients)
        r = await p.run(1)
        assert r.status == "failed"
        assert any("LLM" in m for m in r.problems)

    async def test_short_draft_retried_then_failed(self, project: Path):
        clients = build_clients(draft=FakeLLM("draft", text="太短"))
        p = make_pipeline(project, clients=clients)
        r = await p.run(1)
        assert r.status == "failed"
        assert any("过短" in m for m in r.problems)

    async def test_rejected_commit_needs_user_action(self, project: Path):
        eng = FakeEngine(project, commit_status="rejected",
                         outline="### 第1章：x\n**目标**：y")
        p = make_pipeline(project, engine=eng)
        r = await p.run(1)
        assert r.status == "needs_user_action"
        assert any("rejected" in m or "被拒" in m for m in r.needs_user_action + r.problems)

    async def test_no_commit_and_no_chapter_is_failed(self, project: Path):
        eng = FakeEngine(project, commit_writes_file=False,
                         outline="### 第1章：x\n**目标**：y")
        p = make_pipeline(project, engine=eng)
        r = await p.run(1)
        assert r.status in ("failed", "partial")


class TestProjectionHandling:
    """投影状态分类：vector 降级不算失败，真实失败要暴露。"""

    async def test_all_done_no_problems(self, project: Path):
        eng = FakeEngine(project, projection={
            "state": "done", "index": "done", "summary": "done",
            "memory": "done", "vector": "done"},
            outline="### 第1章：x\n**目标**：y")
        p = make_pipeline(project, engine=eng)
        r = await p.run(1)
        assert r.status == "completed"
        assert not r.problems

    async def test_vector_failure_without_rag_is_auto_handled(self, project: Path):
        """未配 Embedding Key 时上游跳过向量投影、退回 BM25 —— 设计内降级。"""
        eng = FakeEngine(project, projection={
            "state": "done", "index": "done", "summary": "done",
            "memory": "done", "vector": "failed:store_failed"},
            outline="### 第1章：x\n**目标**：y")
        p = make_pipeline(project, engine=eng)
        r = await p.run(1)
        assert r.status == "completed"
        assert any("向量" in m for m in r.auto_handled)
        assert not any("投影" in m for m in r.problems)

    async def test_vector_failure_is_rewritten_to_skipped(self, project: Path):
        """关键回归：vector 的 failed 状态会把项目 phase 拖成 projection_failed，
        导致**后续每一章**的 precommit 被拒。必须改写成 skipped 才能解除。

        实测确认：phase=projection_failed 时 write-gate precommit 直接拒绝；
        改成 skipped 后 phase 变 chapter_committed，阻塞消失。
        """
        eng = FakeEngine(project, projection={
            "state": "done", "index": "done", "summary": "done",
            "memory": "done", "vector": "failed:store_failed"},
            outline="### 第1章：x\n**目标**：y")
        p = make_pipeline(project, engine=eng)
        r = await p.run(1)

        commit = json.loads(
            (project / ".story-system" / "commits" / "chapter_001.commit.json")
            .read_text(encoding="utf-8"))
        assert commit["projection_status"]["vector"] == "skipped", \
            "vector 仍为 failed，下一章的 precommit 会被 phase 拒绝"
        assert r.projection_status["vector"] == "skipped"

    async def test_vector_failure_with_rag_not_rewritten(self, project: Path):
        """配了 RAG 却失败是真故障，不能悄悄改成 skipped。"""
        eng = FakeEngine(project, projection={
            "state": "done", "vector": "failed:store_failed"},
            outline="### 第1章：x\n**目标**：y")
        s = make_settings()
        s.embed_api_key = "sk-x"
        s.embed_base_url = "http://e/v1"
        p = WritePipeline(s, eng, build_clients(), chapter_title="t", genre="玄幻")
        await p.run(1)

        commit = json.loads(
            (project / ".story-system" / "commits" / "chapter_001.commit.json")
            .read_text(encoding="utf-8"))
        assert commit["projection_status"]["vector"] == "failed:store_failed"
        assert "projections_retry" in eng.calls

    async def test_vector_failure_with_rag_triggers_retry(self, project: Path):
        eng = FakeEngine(project, projection={"state": "done",
                                              "vector": "failed:store_failed"},
                         outline="### 第1章：x\n**目标**：y")
        s = make_settings()
        s.embed_api_key = "sk-x"
        s.embed_base_url = "http://e/v1"
        p = WritePipeline(s, eng, build_clients(), chapter_title="t", genre="玄幻")
        await p.run(1)
        assert "projections_retry" in eng.calls

    async def test_next_chapter_not_blocked_after_vector_degradation(self, project: Path):
        """端到端意图：第 1 章 vector 降级后，第 2 章的 precommit 不应被 phase 拒绝。"""
        eng = FakeEngine(project, projection={
            "state": "done", "index": "done", "summary": "done",
            "memory": "done", "vector": "failed:store_failed"},
            outline="### 第1章：x\n**目标**：y")
        p = make_pipeline(project, engine=eng)
        await p.run(1)
        # 第 2 章复用同一 commit 状态检查逻辑
        commit = json.loads(
            (project / ".story-system" / "commits" / "chapter_001.commit.json")
            .read_text(encoding="utf-8"))
        assert not any(
            str(v).startswith("failed:")
            for v in commit["projection_status"].values()
        ), "仍有 failed 投影状态，上游 phase 会阻塞后续所有章节的提交"

    async def test_non_vector_failure_triggers_retry(self, project: Path):
        eng = FakeEngine(project, projection={"state": "done",
                                              "index": "failed:boom"},
                         outline="### 第1章：x\n**目标**：y")
        p = make_pipeline(project, engine=eng)
        await p.run(1)
        assert "projections_retry" in eng.calls

    async def test_skipped_counts_as_ok(self, project: Path):
        eng = FakeEngine(project, projection={"state": "skipped",
                                              "vector": "skipped"},
                         outline="### 第1章：x\n**目标**：y")
        p = make_pipeline(project, engine=eng)
        r = await p.run(1)
        assert r.status == "completed"


class TestPendingDisambiguation:
    """第三类上游阻断：disambiguation_result.pending 非空。

    上游 artifact_validator 把它算作 blocker（artifact.pending_disambiguation），
    提交会被 gate 拒绝。若不显式处理，用户只会看到含糊的 failed。
    """

    @staticmethod
    def _data_with_pending(n: int = 2) -> dict:
        payload = data_payload()
        payload["disambiguation_result"] = {
            "pending": [{"entity": f"e{i}", "confidence": 0.3} for i in range(n)]
        }
        return payload

    async def test_pending_stops_with_needs_user_action(self, project: Path):
        clients = build_clients(data=FakeLLM("data", json_value=self._data_with_pending()))
        p = make_pipeline(project, clients=clients, accept_blocking=False)
        r = await p.run(1)
        assert r.status == "needs_user_action", f"{r.status} {r.problems}"
        assert any("消歧" in m for m in r.needs_user_action)
        assert not r.commit_file, "有待消歧项时不应提交"

    async def test_pending_accepted_clears_and_commits(self, project: Path):
        clients = build_clients(data=FakeLLM("data", json_value=self._data_with_pending()))
        p = make_pipeline(project, clients=clients, accept_blocking=True)
        r = await p.run(1)
        assert r.status == "completed", f"{r.status} {r.problems}"
        assert r.commit_file

        artifact = json.loads(
            (project / ".webnovel" / "tmp" / "disambiguation_result.json")
            .read_text(encoding="utf-8"))
        assert artifact["pending"] == [], "gate 仍会拒绝：pending 未清空"
        assert len(artifact["adjudicated_pending"]) == 2, "审计线索丢失"
        assert artifact["adjudication"]["original_pending_count"] == 2

    async def test_empty_pending_does_not_stop(self, project: Path):
        p = make_pipeline(project)  # data_payload 的 pending 为空
        r = await p.run(1)
        assert r.status == "completed"

    async def test_missing_artifact_does_not_stop(self, project: Path):
        """data 阶段没产出文件时不应误判为待消歧。"""
        p = make_pipeline(project)
        (project / ".webnovel" / "tmp" / "disambiguation_result.json").unlink(
            missing_ok=True)
        r = await p.run(1)
        assert r.status in ("completed", "partial", "failed")


class TestAuthorProtection:
    async def test_existing_chapter_not_overwritten_by_default(self, project: Path):
        existing = project / "正文" / "第0001章-测试章.md"
        existing.write_text("作者手改过的正文。" * 50, encoding="utf-8")
        eng = FakeEngine(project, outline="### 第1章：x\n**目标**：y")
        p = make_pipeline(project, engine=eng, override_existing=False)
        r = await p.run(1)
        assert "作者手改" in existing.read_text(encoding="utf-8")
        assert any("沿用" in m for m in r.auto_handled)

    async def test_override_existing_replaces(self, project: Path):
        existing = project / "正文" / "第0001章-测试章.md"
        existing.write_text("旧正文", encoding="utf-8")
        p = make_pipeline(project, override_existing=True)
        await p.run(1)
        assert "旧正文" not in existing.read_text(encoding="utf-8")

    async def test_stop_after_review_halts_before_commit(self, project: Path):
        p = make_pipeline(project, stop_after_review=True)
        r = await p.run(1)
        assert r.status == "partial"
        assert not r.commit_file
        assert r.chapter_file


class TestJsonRetry:
    """回归：LLM 输出被截断（token 不足）会导致 JSON 解析失败。

    实测发现审查输出较长时会被截断成半截 JSON，单次失败就丢掉整章太脆。
    现在给足 token，并在失败时降温度重试。
    """

    async def test_review_retried_after_parse_failure(self, project: Path):
        from service.llm import LLMError

        calls = {"n": 0}
        review = FakeLLM("review", json_value=review_payload())

        async def flaky(*a, **kw):
            calls["n"] += 1
            if calls["n"] == 1:
                raise LLMError('无法从 LLM 输出解析 JSON: ```json\n{"chapter": 1, "issues": [{"sev')
            return review_payload()

        review.complete_json = flaky
        p = make_pipeline(project, clients=build_clients(review=review))
        r = await p.run(1)
        assert calls["n"] >= 2, "解析失败后未重试"
        assert r.status == "completed", f"{r.status} {r.problems}"

    async def test_data_retried_after_parse_failure(self, project: Path):
        from service.llm import LLMError

        calls = {"n": 0}
        data = FakeLLM("data", json_value=data_payload())

        async def flaky(*a, **kw):
            calls["n"] += 1
            if calls["n"] == 1:
                raise LLMError("无法从 LLM 输出解析 JSON: 截断")
            return data_payload()

        data.complete_json = flaky
        p = make_pipeline(project, clients=build_clients(data=data))
        r = await p.run(1)
        assert calls["n"] >= 2
        assert r.status == "completed", f"{r.status} {r.problems}"

    async def test_review_gives_up_after_retries_with_clear_error(self, project: Path):
        p = make_pipeline(project, clients=build_clients(
            review=FakeLLM("review", fail=True)))
        r = await p.run(1)
        assert r.status == "failed"
        assert any("已重试" in m for m in r.problems), r.problems

    async def test_review_uses_generous_token_budget(self, project: Path):
        """token 给小了会截断，必须给足。"""
        captured = {}

        async def spy(system, user, temperature=None, max_tokens=0):
            captured["max_tokens"] = max_tokens
            return review_payload()

        review = FakeLLM("review", json_value=review_payload())
        review.complete_json = spy
        p = make_pipeline(project, clients=build_clients(review=review))
        await p.run(1)
        assert captured["max_tokens"] >= 16384, \
            f"审查 token 额度偏小，易截断：{captured['max_tokens']}"


class TestModes:
    async def test_minimal_skips_review_pipeline(self, project: Path):
        eng = FakeEngine(project, outline="### 第1章：x\n**目标**：y")
        p = make_pipeline(project, engine=eng, mode="minimal")
        await p.run(1)
        assert "review_pipeline" not in eng.calls

    async def test_result_serializable(self, project: Path):
        p = make_pipeline(project)
        r = await p.run(1)
        blob = json.dumps(r.to_dict(), ensure_ascii=False)
        assert "status" in blob

    def test_resume_stages_cover_pipeline(self):
        assert WritePipeline.RESUME_STAGES[0] == "preflight"
        assert WritePipeline.RESUME_STAGES[-1] == "backup"
        assert WritePipeline.RESUME_STAGES.index("review") < \
            WritePipeline.RESUME_STAGES.index("commit")
