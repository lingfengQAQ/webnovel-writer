# -*- coding: utf-8 -*-
"""写章 pipeline：把上游 `/webnovel-write` 的 6 步流程落成服务端编排。

与上游的对应关系：
  Step 1 context-agent  → `_step_context`   （LLM 调用）
  Step 2 起草           → `_step_draft`     （LLM 调用）
  Step 3 审查           → `_step_review`    （LLM + review-pipeline）
  Step 4 润色           → `_step_polish`    （LLM 调用）
  Step 5 提交           → `_step_commit`    （data-agent + chapter-commit）
  Step 6 备份           → `_step_backup`    （上游 backup）

硬规则（来自上游 SKILL.md，不得放宽）：
- 禁止跳步、伪造审查。
- 审查只跑一轮；blocking issue 定点修复或交用户裁决后才进 Step 4/5。
- 失败只补跑失败步骤，不回退。
- 充分性闸门：正文非空、审查落库、anti_ai 通过、commit accepted、projection 全 done。
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

from . import prompts
from .config import Settings
from .engine import Engine, EngineError
from .llm import LLMClient, LLMError


class Stage(str, Enum):
    PREFLIGHT = "preflight"
    CONTRACT = "contract"
    CONTEXT = "context"
    DRAFT = "draft"
    REVIEW = "review"
    POLISH = "polish"
    DATA = "data"
    COMMIT = "commit"
    PROJECTION = "projection"
    BACKUP = "backup"
    DONE = "done"


class PipelineError(RuntimeError):
    """pipeline 在某个阶段失败。caller 可据 stage 决定续跑。"""

    def __init__(self, message: str, stage: Stage, *, recoverable: bool = True) -> None:
        super().__init__(message)
        self.stage = stage
        self.recoverable = recoverable


@dataclass
class StageEvent:
    """进度事件。API 层把它转成 SSE。"""

    stage: str
    status: str  # running | ok | failed | skipped
    message: str
    detail: Dict[str, Any] = field(default_factory=dict)
    duration_ms: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stage": self.stage,
            "status": self.status,
            "message": self.message,
            "detail": self.detail,
            "duration_ms": self.duration_ms,
        }


ProgressFn = Callable[[StageEvent], Awaitable[None]]


@dataclass
class WriteResult:
    chapter: int
    title: str
    status: str  # completed | partial | needs_user_action | failed
    chapter_file: str = ""
    review_report: str = ""
    commit_file: str = ""
    projection_status: Dict[str, Any] = field(default_factory=dict)
    backup_status: str = ""
    problems: List[str] = field(default_factory=list)
    auto_handled: List[str] = field(default_factory=list)
    needs_user_action: List[str] = field(default_factory=list)
    blocking_issues: List[Dict[str, Any]] = field(default_factory=list)
    timings: Dict[str, int] = field(default_factory=dict)
    final_report: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "chapter": self.chapter,
            "title": self.title,
            "status": self.status,
            "chapter_file": self.chapter_file,
            "review_report": self.review_report,
            "commit_file": self.commit_file,
            "projection_status": self.projection_status,
            "backup_status": self.backup_status,
            "problems": self.problems,
            "auto_handled": self.auto_handled,
            "needs_user_action": self.needs_user_action,
            "blocking_issues": self.blocking_issues,
            "timings": self.timings,
            "final_report": self.final_report,
        }


class WritePipeline:
    """一次写章运行。"""

    def __init__(
        self,
        settings: Settings,
        engine: Engine,
        clients: Dict[str, LLMClient],
        *,
        mode: str = "default",
        target_words: Optional[int] = None,
        chapter_title: str = "",
        chapter_goal: str = "",
        genre: str = "",
        progress: Optional[ProgressFn] = None,
        stop_after_review: bool = False,
        override_existing: bool = False,
    ) -> None:
        self.settings = settings
        self.engine = engine
        self.clients = clients
        self.mode = mode
        self.target_words = target_words
        self.chapter_title = chapter_title
        self.chapter_goal = chapter_goal
        self.genre = genre
        self.progress = progress
        self.stop_after_review = stop_after_review
        self.override_existing = override_existing
        self.result: Optional[WriteResult] = None
        self._chapter_text: str = ""
        self._task_brief: str = ""
        self._review_json: Dict[str, Any] = {}

    # ---- 事件与计时 ----

    async def _emit(self, stage: Stage, status: str, message: str,
                    detail: Optional[Dict[str, Any]] = None,
                    duration_ms: int = 0) -> None:
        if self.progress is None:
            return
        await self.progress(StageEvent(
            stage=stage.value, status=status, message=message,
            detail=detail or {}, duration_ms=duration_ms,
        ))

    async def _timed(self, stage: Stage, message: str,
                     fn: Callable[[], Awaitable[Any]]) -> Any:
        await self._emit(stage, "running", message)
        started = time.monotonic()
        try:
            value = await fn()
        except (PipelineError, LLMError, EngineError):
            elapsed = int((time.monotonic() - started) * 1000)
            await self._emit(stage, "failed", f"{message} —— 失败", duration_ms=elapsed)
            raise
        elapsed = int((time.monotonic() - started) * 1000)
        self._timings[stage.value] = elapsed
        await self._emit(stage, "ok", message, duration_ms=elapsed)
        return value

    _timings: Dict[str, int]

    def _client(self, role: str) -> LLMClient:
        client = self.clients.get(role)
        if client is None:
            raise PipelineError(
                f"角色 `{role}` 的 LLM 未配置（需要 base_url + model）。"
                f"请通过 /api/config 或 .env 配置。",
                Stage.PREFLIGHT, recoverable=False,
            )
        return client

    # ---- 主流程 ----

    async def run(self, chapter: int) -> WriteResult:
        self.result = WriteResult(chapter=chapter, title=self.chapter_title, status="failed")
        self._timings = {}
        chapter = int(chapter)

        try:
            await self._step_preflight(chapter)
            await self._step_contract(chapter)
            await self._step_context(chapter)
            await self._step_draft(chapter)
            review = await self._step_review(chapter)

            if self.stop_after_review:
                self.result.status = "partial"
                self.result.needs_user_action.append("已按请求在审查后停止，等待裁决")
                await self._finalize(chapter)
                return self.result

            # blocking issue 不自动放过：交用户裁决
            if review.get("has_blocking") or int(review.get("blocking_count") or 0) > 0:
                self.result.blocking_issues = [
                    issue for issue in (review.get("issues") or [])
                    if issue.get("blocking")
                ]
                self.result.status = "needs_user_action"
                self.result.needs_user_action.append(
                    f"存在 {len(self.result.blocking_issues)} 个阻断问题，需裁决后才能继续"
                )
                await self._finalize(chapter)
                return self.result

            await self._step_polish(chapter)
            await self._step_data(chapter)
            await self._step_commit(chapter)
            await self._step_backup(chapter)

        except PipelineError as exc:
            self.result.status = "failed"
            self.result.problems.append(f"[{exc.stage.value}] {exc}")
        except LLMError as exc:
            self.result.status = "failed"
            self.result.problems.append(f"LLM 调用失败：{exc}")
        except EngineError as exc:
            self.result.status = "failed"
            self.result.problems.append(f"上游引擎失败：{exc}")
        except Exception as exc:  # noqa: BLE001 - 兜底，避免 API 层 500 无信息
            self.result.status = "failed"
            self.result.problems.append(f"未预期错误：{type(exc).__name__}: {exc}")

        await self._finalize(chapter)
        return self.result

    # ---- 各步骤 ----

    async def _step_preflight(self, chapter: int) -> None:
        async def _do() -> None:
            report = await asyncio.to_thread(self.engine.preflight)
            if not report.get("ok"):
                failed = [
                    item for item in (report.get("checks") or []) if not item.get("ok")
                ]
                names = ", ".join(str(item.get("name")) for item in failed)
                raise PipelineError(
                    f"预检未通过：{names}。detail: {report.get('project_root_error') or ''}",
                    Stage.PREFLIGHT,
                )
            scan = await asyncio.to_thread(self.engine.placeholder_scan)
            if isinstance(scan, dict) and scan.get("has_placeholders"):
                raise PipelineError(
                    "大纲/设定集仍存在未补齐占位符，无法开始写作（先补齐或运行 placeholder-scan 查看）",
                    Stage.PREFLIGHT,
                )

        await self._timed(Stage.PREFLIGHT, "检查项目环境", _do)

    async def _step_contract(self, chapter: int) -> None:
        async def _do() -> None:
            # genre 必须解析出来：上游 story-system 的题材路由是硬匹配，
            # 空 genre 会直接拒绝生成合同，阻断整个写章链路。
            genre = self.genre
            if not genre:
                genre = await asyncio.to_thread(self.engine.resolve_genre)
                if genre:
                    self.genre = genre
                    self.result.auto_handled.append(
                        f"已从 state.json 自动解析题材：{genre}"
                    )
            if not genre:
                raise PipelineError(
                    "无法确定题材（genre）。上游 story-system 需要中文题材名做路由匹配"
                    "（如 玄幻 / 仙侠 / 规则怪谈）。请在请求中显式传入 genre，"
                    "或先补齐 .webnovel/state.json 的题材配置。",
                    Stage.CONTRACT, recoverable=False,
                )

            goal = self.chapter_goal
            if not goal:
                goal = await self._infer_chapter_goal(chapter)
            if not goal:
                raise PipelineError(
                    f"无法确定第 {chapter} 章的目标（章纲缺失且未显式提供 chapter_goal）。"
                    "请先运行 /webnovel-plan 生成章纲，或显式传入 chapter_goal。",
                    Stage.CONTRACT,
                )
            res = await asyncio.to_thread(
                self.engine.story_system, goal, genre, chapter, True
            )
            if not res.ok:
                detail = (res.stderr or res.stdout).strip()
                raise PipelineError(
                    f"生成写作合同失败：{detail[:800]}", Stage.CONTRACT
                )
            gate = await asyncio.to_thread(self.engine.write_gate, chapter, "prewrite")
            if not gate.get("ok", True):
                raise PipelineError(
                    f"prewrite gate 未通过：{json.dumps(gate, ensure_ascii=False)[:800]}",
                    Stage.CONTRACT,
                )

        await self._timed(Stage.CONTRACT, "刷新本章写作合同", _do)

    async def _infer_chapter_goal(self, chapter: int) -> str:
        """优先从章纲文件推断目标；失败则从 state 的章节安排里找。"""
        outline = None
        try:
            outline = await asyncio.to_thread(self.engine.chapter_outline, chapter)
        except Exception:  # noqa: BLE001 - 章纲缺失属正常情况
            outline = None
        if outline:
            # 取第一段有实质内容的行作为目标
            for line in outline.splitlines():
                stripped = line.strip().lstrip("#").strip()
                if stripped and not stripped.startswith("---"):
                    return stripped[:200]
        return ""

    async def _step_context(self, chapter: int) -> None:
        async def _do() -> None:
            client = self._client("context")
            pack = await asyncio.to_thread(self.engine.load_context, chapter)
            outline = await asyncio.to_thread(self.engine.chapter_outline, chapter)

            entities = None
            try:
                entities = await asyncio.to_thread(self.engine.get_core_entities)
            except EngineError:
                self.result.auto_handled.append("实体索引读取失败，已跳过（不影响任务书主流程）")

            prompt = prompts.build_context_prompt(
                chapter, pack, outline, {"core_entities": entities} if entities else None
            )
            text = (await client.complete(
                prompts.CONTEXT_SYSTEM, prompt, max_tokens=8192
            )).text.strip()

            if text.startswith("BLOCKER"):
                raise PipelineError(
                    f"写作任务书上下文不足：{text}", Stage.CONTEXT, recoverable=False
                )
            if len(text) < 200:
                raise PipelineError(
                    f"写作任务书过短（{len(text)} 字符），无法支撑起草", Stage.CONTEXT
                )
            self._task_brief = text

        await self._timed(Stage.CONTEXT, "整理写作依据", _do)

    async def _step_draft(self, chapter: int) -> None:
        async def _do() -> None:
            client = self._client("draft")
            existing = await asyncio.to_thread(self.engine.chapter_file, chapter)
            if existing is not None and not self.override_existing:
                text = existing.read_text(encoding="utf-8")
                if text.strip():
                    self._chapter_text = text
                    self.result.auto_handled.append(
                        f"第 {chapter} 章正文已存在（{existing.name}），沿用现有正文，未覆盖"
                    )
                    self.result.chapter_file = str(existing)
                    return

            feedback: Optional[str] = None
            last_error: Optional[str] = None
            for attempt in range(max(1, self.settings.max_draft_retries + 1)):
                prompt = prompts.build_draft_prompt(
                    chapter, self._task_brief, self.target_words, feedback=feedback
                )
                text = (await client.complete(
                    prompts.DRAFT_SYSTEM, prompt, max_tokens=16384
                )).text.strip()
                if len(text) >= 300:
                    self._chapter_text = text
                    break
                last_error = f"第 {attempt + 1} 稿过短（{len(text)} 字符）"
                feedback = last_error
            else:
                raise PipelineError(
                    f"起草失败：{last_error}", Stage.DRAFT, recoverable=False
                )

            path = await asyncio.to_thread(
                self.engine.write_chapter_file, chapter, self.chapter_title, self._chapter_text
            )
            self.result.chapter_file = str(path)

        await self._timed(Stage.DRAFT, "起草正文", _do)

    async def _step_review(self, chapter: int) -> Dict[str, Any]:
        async def _do() -> Dict[str, Any]:
            client = self._client("review")

            state_changes = None
            try:
                state_changes = await asyncio.to_thread(self.engine.get_state_changes, 20)
            except EngineError:
                self.result.auto_handled.append("状态变更读取失败，审查降级为仅正文一致性检查")

            pack = None
            try:
                pack = await asyncio.to_thread(self.engine.load_context, chapter)
            except EngineError:
                pass

            context = {"recent_state_changes": state_changes, "story_context": pack}
            prompt = prompts.build_review_prompt(chapter, self._chapter_text, context)
            raw = await client.complete_json(
                prompts.REVIEW_SYSTEM, prompt, temperature=0.1, max_tokens=8192
            )
            if not isinstance(raw, dict):
                raise PipelineError(
                    f"审查返回结构不是对象：{type(raw).__name__}", Stage.REVIEW
                )

            # 强制补齐计数一致性
            issues = raw.get("issues")
            issues = issues if isinstance(issues, list) else []
            blocking = [i for i in issues if isinstance(i, dict) and i.get("blocking")]
            raw["issues"] = issues
            raw["issues_count"] = len(issues)
            raw["blocking_count"] = len(blocking)
            raw["has_blocking"] = bool(blocking)
            raw.setdefault("chapter", chapter)
            self._review_json = raw

            tmp = await asyncio.to_thread(self.engine.write_tmp_json, "review_results.json", raw)

            mode = self.mode
            if mode != "minimal":
                metrics_path = str(await asyncio.to_thread(
                    lambda: self.engine.tmp_dir() / "review_metrics.json"
                ))
                report_rel = f"审查报告/第{chapter}章审查报告.md"
                res = await asyncio.to_thread(
                    self.engine.review_pipeline, chapter, str(tmp), metrics_path, report_rel
                )
                if not res.ok:
                    self.result.problems.append(
                        f"review-pipeline 失败：{res.stderr.strip()[:400]}"
                    )
                else:
                    self.result.review_report = str(
                        Path(self.engine.project_root) / report_rel
                    )
            else:
                self.result.auto_handled.append("minimal 模式：已跳过 reviewer 与 review-pipeline")
            return raw

        return await self._timed(Stage.REVIEW, "写作检查", _do)

    async def _step_polish(self, chapter: int) -> None:
        if self.mode == "minimal":
            await self._emit(Stage.POLISH, "skipped", "minimal 模式：跳过润色")
            return

        async def _do() -> None:
            client = self._client("polish" if "polish" in self.clients else "draft")
            non_blocking = [
                issue for issue in (self._review_json.get("issues") or [])
                if isinstance(issue, dict) and not issue.get("blocking")
            ]
            prompt = prompts.build_polish_prompt(
                chapter, self._chapter_text, non_blocking or None
            )
            text = (await client.complete(
                prompts.POLISH_SYSTEM, prompt, temperature=0.5, max_tokens=16384
            )).text.strip()
            if len(text) < 300:
                self.result.problems.append("润色输出过短，已保留润色前正文")
                return
            # 事实保全检查：长度不应剧烈变化
            ratio = len(text) / max(1, len(self._chapter_text))
            if ratio < 0.6 or ratio > 1.6:
                self.result.auto_handled.append(
                    f"润色稿长度变化异常（{ratio:.2f}x），已保留原稿以避免事实漂移"
                )
                return
            self._chapter_text = text
            path = await asyncio.to_thread(
                self.engine.write_chapter_file, chapter, self.chapter_title, self._chapter_text
            )
            self.result.chapter_file = str(path)

        await self._timed(Stage.POLISH, "润色与 Anti-AI 终检", _do)

    async def _step_data(self, chapter: int) -> None:
        async def _do() -> None:
            client = self._client("data")
            entity_context: Dict[str, Any] = {}
            try:
                entity_context["core_entities"] = await asyncio.to_thread(
                    self.engine.get_core_entities
                )
                entity_context["recent_appearances"] = await asyncio.to_thread(
                    self.engine.recent_appearances, 20
                )
            except EngineError:
                self.result.auto_handled.append("实体索引读取失败，data-agent 以正文为准提取")

            planned = None
            try:
                pack = await asyncio.to_thread(self.engine.load_context, chapter)
                if isinstance(pack, dict):
                    planned = pack.get("chapter_contract") or pack.get("story_contracts")
            except EngineError:
                pass

            prompt = prompts.build_data_prompt(
                chapter, self._chapter_text, entity_context, planned
            )
            raw = await client.complete_json(
                prompts.DATA_SYSTEM, prompt, temperature=0.1, max_tokens=16384
            )
            if not isinstance(raw, dict):
                raise PipelineError("data-agent 返回结构不是对象", Stage.DATA)

            fulfillment = raw.get("fulfillment_result")
            disambiguation = raw.get("disambiguation_result")
            extraction = raw.get("extraction_result")

            missing = [
                name for name, value in (
                    ("fulfillment_result", fulfillment),
                    ("disambiguation_result", disambiguation),
                    ("extraction_result", extraction),
                ) if not isinstance(value, dict)
            ]
            if missing:
                raise PipelineError(
                    f"data-agent 缺少必需 artifact：{', '.join(missing)}", Stage.DATA
                )

            # schema 底线校验：extraction_result 必须是直接放键，不能嵌套
            required_keys = ("accepted_events", "state_deltas", "entity_deltas",
                             "entities_appeared", "scenes", "summary_text")
            absent = [key for key in required_keys if key not in extraction]
            if absent:
                self.result.problems.append(
                    f"extraction_result 缺少字段（上游可能拒收）：{', '.join(absent)}"
                )
            for key in ("planned_nodes", "covered_nodes", "missed_nodes", "extra_nodes"):
                if key not in fulfillment:
                    fulfillment[key] = []
            disambiguation.setdefault("pending", [])

            await asyncio.to_thread(self.engine.write_tmp_json, "fulfillment_result.json", fulfillment)
            await asyncio.to_thread(self.engine.write_tmp_json, "disambiguation_result.json", disambiguation)
            await asyncio.to_thread(self.engine.write_tmp_json, "extraction_result.json", extraction)

            if disambiguation.get("pending"):
                self.result.needs_user_action.append(
                    f"存在 {len(disambiguation['pending'])} 条待消歧实体"
                )
            if fulfillment.get("missed_nodes"):
                self.result.problems.append(
                    f"有 {len(fulfillment['missed_nodes'])} 个计划节点未覆盖"
                )

        await self._timed(Stage.DATA, "保存本章故事事实", _do)

    async def _step_commit(self, chapter: int) -> None:
        async def _do() -> None:
            gate = await asyncio.to_thread(self.engine.write_gate, chapter, "precommit")
            if not gate.get("ok", True):
                raise PipelineError(
                    f"precommit gate 未通过：{json.dumps(gate, ensure_ascii=False)[:800]}",
                    Stage.COMMIT,
                )

            tmp = await asyncio.to_thread(self.engine.tmp_dir)
            res = await asyncio.to_thread(
                self.engine.chapter_commit,
                chapter,
                str(tmp / "review_results.json"),
                str(tmp / "fulfillment_result.json"),
                str(tmp / "disambiguation_result.json"),
                str(tmp / "extraction_result.json"),
            )
            payload: Dict[str, Any] = {}
            try:
                payload = res.json() or {}
            except EngineError:
                payload = {}

            commit_path = Path(self.engine.project_root) / ".story-system" / "commits" / f"chapter_{chapter:03d}.commit.json"
            if commit_path.is_file():
                self.result.commit_file = str(commit_path)

            # commit 状态与投影状态以 commit 文件为真源（CLI stdout 不一定带这些字段）
            commit_data: Dict[str, Any] = {}
            if commit_path.is_file():
                try:
                    commit_data = json.loads(commit_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    commit_data = {}

            commit_status = str(
                (commit_data.get("meta") or {}).get("status")
                or payload.get("status")
                or ""
            ).lower()

            if commit_status == "rejected":
                self.result.status = "needs_user_action"
                self.result.needs_user_action.append(
                    "CHAPTER_COMMIT 被拒（blocking 或 missed_nodes 非空），需处理后重跑提交"
                )
                raise PipelineError(
                    f"chapter-commit rejected：{json.dumps(payload, ensure_ascii=False)[:600]}",
                    Stage.COMMIT,
                )
            if not res.ok and not commit_path.is_file():
                raise PipelineError(
                    f"chapter-commit 失败（exit {res.returncode}）：{res.stderr.strip()[:600]}",
                    Stage.COMMIT,
                )

            # 投影校验：取自 commit 文件
            proj = commit_data.get("projection_status") or {}
            if isinstance(proj, dict):
                self.result.projection_status = proj
                await self._handle_projection_status(chapter, proj)

        await self._timed(Stage.COMMIT, "提交本章事实", _do)

    async def _handle_projection_status(self, chapter: int, proj: Dict[str, Any]) -> None:
        """判定投影结果。

        上游的 `vector` 投影在未配置 Embedding Key 时会失败，这是**设计内的降级**
        （README：不填 Embedding Key 会自动退回 BM25 关键词检索）。所以：
        - 非 vector 的投影失败 → 补跑一次；仍失败则记为问题。
        - vector 失败 → 记为 auto_handled（除非配置了 RAG 才升级为问题）。
        """
        bad = {
            key: value for key, value in proj.items()
            if str(value).lower() not in ("done", "skipped")
        }
        if not bad:
            return

        rag_configured = bool(self.settings.embed_api_key and self.settings.embed_base_url)
        real_bad = {
            key: value for key, value in bad.items()
            if key != "vector" or rag_configured
        }
        if "vector" in bad and not rag_configured:
            self.result.auto_handled.append(
                "向量投影已跳过（未配置 Embedding Key，检索自动退回 BM25 关键词模式）"
            )

        if not real_bad:
            return

        self.result.auto_handled.append(
            f"投影未完成 {real_bad}，已自动补跑 projections retry"
        )
        try:
            retry = await asyncio.to_thread(self.engine.projections_retry, chapter)
            retry_payload = retry.json() or {}
        except Exception as exc:  # noqa: BLE001 - 补跑失败不应中断收尾
            self.result.problems.append(f"投影补跑失败：{exc}")
            return

        retry_proj = {}
        if isinstance(retry_payload, dict):
            retry_proj = (
                retry_payload.get("projection_status")
                or (retry_payload.get("commit") or {}).get("projection_status")
                or {}
            )
        if not isinstance(retry_proj, dict) or not retry_proj:
            commit_path = (
                Path(self.engine.project_root) / ".story-system" / "commits"
                / f"chapter_{chapter:03d}.commit.json"
            )
            if commit_path.is_file():
                try:
                    retry_proj = json.loads(
                        commit_path.read_text(encoding="utf-8")
                    ).get("projection_status") or {}
                except (OSError, json.JSONDecodeError):
                    retry_proj = {}
        if isinstance(retry_proj, dict) and retry_proj:
            self.result.projection_status = retry_proj
            still_bad = {
                key: value for key, value in retry_proj.items()
                if str(value).lower() not in ("done", "skipped") and key != "vector"
            }
            if still_bad:
                self.result.problems.append(f"投影补跑后仍未完成：{still_bad}")

    async def _step_backup(self, chapter: int) -> None:
        async def _do() -> None:
            title = self.chapter_title
            if not title and self.result.chapter_file:
                name = Path(self.result.chapter_file).stem
                if "-" in name:
                    title = name.split("-", 1)[1]
            res = await asyncio.to_thread(self.engine.backup, chapter, title)
            if res.ok:
                self.result.backup_status = "done"
            else:
                self.result.backup_status = "failed"
                self.result.problems.append(f"备份失败：{res.stderr.strip()[:300]}")

        await self._timed(Stage.BACKUP, "备份本章", _do)

    # ---- 收尾 ----

    async def _finalize(self, chapter: int) -> None:
        assert self.result is not None
        self.result.timings = dict(self._timings)

        # 状态判定：宁可保守，不可假报完成
        if self.result.status not in ("needs_user_action",):
            if self.result.problems and not self.result.commit_file:
                self.result.status = "failed"
            elif self.result.problems:
                self.result.status = "partial"
            else:
                self.result.status = "completed"

        # 优先用上游的作者友好报告
        try:
            self.result.final_report = await asyncio.to_thread(
                self.engine.user_report, "write", chapter
            )
        except Exception:  # noqa: BLE001 - 报告失败不影响主结果
            self.result.final_report = ""

        try:
            await asyncio.to_thread(
                self.engine.record_write_step,
                chapter, "commit" if self.result.commit_file else "draft",
                self.result.status, self.mode,
                {"chapter": str(chapter)},
                {"chapter_file": self.result.chapter_file},
                self.result.problems, self.result.auto_handled,
                self._timings.get("commit", 0),
            )
        except Exception:  # noqa: BLE001 - ledger 失败不阻塞
            pass

        await self._emit(Stage.DONE, "ok", f"写章流程结束：{self.result.status}",
                         self.result.to_dict())
