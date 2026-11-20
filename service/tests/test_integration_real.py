# -*- coding: utf-8 -*-
"""真实 LLM 端到端集成测试（默认 skip）。

与其它测试文件不同，这里**不 mock LLM**，会真的调用 API。
因此默认跳过，只在显式提供凭据时运行：

    # 方式一：环境变量
    set WEBNOVEL_E2E_BASE_URL=http://your-endpoint/v1
    set WEBNOVEL_E2E_API_KEY=sk-xxx
    set WEBNOVEL_E2E_MODEL=your-model
    python -m pytest -c service/pytest.ini service/tests/test_integration_real.py -v

    # 方式二：从 DSH 凭据里取（本机开发用）
    set WEBNOVEL_E2E_FROM_DSH=WORKBUDDY_API_KEY

覆盖的是 mock 测不出来的东西：真实模型是否按 schema 返回 JSON、
上游 CLI 是否接受我们的 artifact、投影链是否真的落盘。

成本提示：一次完整跑约 2-5 分钟，消耗真实 token。
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from service.config import load_settings  # noqa: E402
from service.engine import Engine  # noqa: E402
from service.llm import LLMClient  # noqa: E402
from service.planner import PlanPipeline  # noqa: E402
from service.pipeline import WritePipeline  # noqa: E402

DSH_CREDENTIALS = Path.home() / ".dsh" / ".credentials.yaml"


def _resolve_credentials() -> tuple[str, str, str] | None:
    """返回 (base_url, api_key, model)；缺任一则 None。"""
    base = os.environ.get("WEBNOVEL_E2E_BASE_URL", "")
    key = os.environ.get("WEBNOVEL_E2E_API_KEY", "")
    model = os.environ.get("WEBNOVEL_E2E_MODEL", "")

    from_dsh = os.environ.get("WEBNOVEL_E2E_FROM_DSH", "")
    if from_dsh and DSH_CREDENTIALS.is_file():
        try:
            import yaml
            refs = (yaml.safe_load(DSH_CREDENTIALS.read_text(encoding="utf-8"))
                    or {}).get("refs") or {}
            key = key or refs.get(from_dsh, "")
            base = base or os.environ.get("WEBNOVEL_E2E_BASE_URL",
                                          "http://192.168.31.180:3003/v1")
            model = model or os.environ.get("WEBNOVEL_E2E_MODEL",
                                            "deepseek-v4.1-flash")
        except Exception:  # noqa: BLE001
            return None
    if not (base and key and model):
        return None
    return base, key, model


CREDS = _resolve_credentials()

pytestmark = pytest.mark.skipif(
    CREDS is None,
    reason=(
        "未提供真实 LLM 凭据。设置 WEBNOVEL_E2E_BASE_URL / WEBNOVEL_E2E_API_KEY "
        "/ WEBNOVEL_E2E_MODEL，或设 WEBNOVEL_E2E_FROM_DSH=<凭据名> 从 DSH 读取。"
    ),
)


def _settings(project: Path):
    assert CREDS is not None
    base, key, model = CREDS
    s = load_settings(str(project))
    s.llm.base_url = base
    s.llm.api_key = key
    s.llm.model = model
    s.llm.api = "openai-completions"
    s.llm.max_tokens = 16384
    s.llm.timeout_s = 600
    return s


def _clients(s):
    return {r: LLMClient(s.role(r), role_name=r)
            for r in ("context", "draft", "review", "data")}


def _init_project(root: Path, title: str) -> Engine:
    """用上游 init 建项目（走真实 CLI）。"""
    eng = Engine(_settings(root), project_root=None)
    res = eng.init_project(str(root), title, "玄幻")
    assert res.returncode == 0, res.stderr
    assert (root / ".webnovel" / "state.json").is_file()
    return Engine(_settings(root), project_root=str(root))


@pytest.mark.timeout(1800)
class TestRealEndToEnd:
    """完整链路：init → plan → write。"""

    async def test_full_flow(self, tmp_path: Path):
        root = tmp_path / "book"
        engine = _init_project(root, "集成测试之书")
        s = _settings(root)

        # ── 阶段 1：规划 ──
        planner = PlanPipeline(
            s, engine, _clients(s),
            volume=1, chapter_start=1, chapter_end=2,
            genre="玄幻", batch_size=2,
        )
        plan = await planner.run()
        assert plan.status in ("completed", "partial"), plan.problems
        assert plan.chapters_planned, "未生成任何章纲"
        assert Path(plan.outline_file).is_file()

        # 章纲必须能被读回 —— 否则写章仍会失败
        outline = engine.chapter_outline(1)
        assert outline, "规划后章纲不可读，写章将失败"

        # ── 阶段 2：写章 ──
        writer = WritePipeline(
            s, engine, _clients(s),
            chapter_title="", genre="玄幻", override_existing=True,
        )
        result = await writer.run(1)

        # 允许 needs_user_action（模型确实可能审查出阻断），但必须有正文
        assert result.status in ("completed", "needs_user_action", "partial"), \
            result.problems
        assert result.chapter_file, "未产出正文"
        text = Path(result.chapter_file).read_text(encoding="utf-8")
        assert len(text) > 800, f"正文过短：{len(text)} 字"

        # 审查必须落库
        review_file = root / ".webnovel" / "tmp" / "review_results.json"
        assert review_file.is_file(), "审查结果未落盘"
        review = json.loads(review_file.read_text(encoding="utf-8"))
        assert "issues" in review
        assert "blocking_count" in review

    async def test_blocking_can_be_resolved(self, tmp_path: Path):
        """阻断必须可解：停下 → 裁决 → 续跑完成提交。

        这是"死路"回归测试的真实版本。若模型未产出阻断，则用注入方式
        确保走的是同一条代码路径。
        """
        root = tmp_path / "book2"
        engine = _init_project(root, "阻断验证之书")
        s = _settings(root)

        planner = PlanPipeline(
            s, engine, _clients(s),
            volume=1, chapter_start=1, chapter_end=1,
            genre="玄幻", batch_size=1,
        )
        plan = await planner.run()
        assert plan.chapters_planned

        writer = WritePipeline(
            s, engine, _clients(s),
            chapter_title="", genre="玄幻", override_existing=True,
        )
        first = await writer.run(1)
        assert first.chapter_file

        # 注入一个阻断审查结果，确保走到阻断分支
        review_file = root / ".webnovel" / "tmp" / "review_results.json"
        review_file.write_text(json.dumps({
            "chapter": 1,
            "issues": [{
                "severity": "critical", "category": "logic", "location": "第1段",
                "description": "集成测试注入的阻断项", "evidence": "e",
                "fix_hint": "f", "blocking": True,
            }],
            "issues_count": 1, "blocking_count": 1, "has_blocking": True,
            "dimension_results": [], "summary": "注入阻断",
        }, ensure_ascii=False, indent=2), encoding="utf-8")

        # 从 review 阶段起跑（会重跑审查，但这里覆盖 artifact 后立即读到注入内容）
        # 更直接：从 polish 起跑，此时阻断检查会读磁盘上的 artifact
        stopper = WritePipeline(
            s, engine, _clients(s), chapter_title="", genre="玄幻",
            override_existing=True,
        )
        stopped = await stopper.run(1, from_stage="polish")
        assert stopped.status == "needs_user_action", \
            f"阻断未拦住：{stopped.status} {stopped.problems}"
        assert stopped.blocking_issues, "未记录阻断项"
        assert (root / ".webnovel" / "tmp" / "blocking_state.json").is_file()

        # 接受的运行：裁决写入 artifact 并完成提交
        finisher = WritePipeline(
            s, engine, _clients(s), chapter_title="", genre="玄幻",
            accept_blocking=True,
        )
        done = await finisher.run(1, from_stage="polish")
        assert done.commit_file, f"裁决后仍未提交：{done.problems}"

        artifact = json.loads(review_file.read_text(encoding="utf-8"))
        assert artifact["blocking_count"] == 0, "gate 仍会拒绝：未清零"
        assert artifact["adjudicated_blocking_issues"], "审计线索丢失"


@pytest.mark.timeout(300)
class TestRealLLMContract:
    """只验证 LLM 是否按我们的 schema 返回，不做完整流程（快得多）。"""

    async def test_reviewer_returns_valid_json(self, tmp_path: Path):
        s = _settings(tmp_path)
        client = LLMClient(s.role("review"), role_name="review")
        from service import prompts

        raw = await client.complete_json(
            prompts.REVIEW_SYSTEM,
            prompts.build_review_prompt(
                1, "第一段。\n第二段。\n第三段。", {"note": "无额外依据"}),
            temperature=0.1, max_tokens=2048,
        )
        assert isinstance(raw, dict), f"返回不是对象：{type(raw)}"
        assert "issues" in raw
        assert "dimension_results" in raw

    async def test_data_agent_returns_three_artifacts(self, tmp_path: Path):
        s = _settings(tmp_path)
        client = LLMClient(s.role("data"), role_name="data")
        from service import prompts

        raw = await client.complete_json(
            prompts.DATA_SYSTEM,
            prompts.build_data_prompt(
                1,
                "林昭走进药园，看见一株枯死的灵草。他蹲下细看，"
                "发现根茎处有一丝极淡的灵光。",
                {"core_entities": []},
            ),
            temperature=0.1, max_tokens=4096,
        )
        assert isinstance(raw, dict)
        for key in ("fulfillment_result", "disambiguation_result",
                    "extraction_result"):
            assert key in raw, f"缺少 {key}"
        extraction = raw["extraction_result"]
        # 规范字段必须直接放顶层，不能嵌套
        assert "extraction" not in extraction, "extraction_result 被错误嵌套"
        assert "summary_text" in extraction
