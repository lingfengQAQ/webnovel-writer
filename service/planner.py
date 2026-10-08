# -*- coding: utf-8 -*-
"""规划 pipeline：卷纲 + 章纲（对应上游 `/webnovel-plan`）。

这是让 `init → write` 真正走通的关键。上游 init 只产出 `大纲/总纲.md`，
没有任何章纲；而写章第一步就要从章纲解析本章目标。没有这一步，
新项目永远写不了第一章。

产出（与上游 plan skill 的落盘约定一致）：
  大纲/第{N}卷-节拍表.md
  大纲/第{N}卷-时间线.md
  大纲/第{N}卷-详细大纲.md     ← 章纲在这里，按 `### 第N章：标题` 分节

写完章纲后调用上游 `story-system` 刷新写作合同，使写章阶段可直接接续。
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

from . import prompts
from .config import Settings
from .engine import Engine, EngineError
from .llm import LLMClient, LLMError
from .pipeline import PipelineError, Stage, StageEvent

ProgressFn = Callable[[StageEvent], Awaitable[None]]

# 上游 plan skill 的批次规则
DEFAULT_BATCH = 10
MAX_BATCH = 12


@dataclass
class PlanResult:
    volume: int
    status: str  # completed | partial | needs_user_action | failed
    chapter_start: int = 0
    chapter_end: int = 0
    beats_file: str = ""
    timeline_file: str = ""
    outline_file: str = ""
    chapters_planned: List[int] = field(default_factory=list)
    problems: List[str] = field(default_factory=list)
    auto_handled: List[str] = field(default_factory=list)
    needs_user_action: List[str] = field(default_factory=list)
    timings: Dict[str, int] = field(default_factory=dict)
    final_report: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "volume": self.volume,
            "status": self.status,
            "chapter_start": self.chapter_start,
            "chapter_end": self.chapter_end,
            "beats_file": self.beats_file,
            "timeline_file": self.timeline_file,
            "outline_file": self.outline_file,
            "chapters_planned": self.chapters_planned,
            "problems": self.problems,
            "auto_handled": self.auto_handled,
            "needs_user_action": self.needs_user_action,
            "timings": self.timings,
            "final_report": self.final_report,
        }


class PlanPipeline:
    """卷规划运行。"""

    def __init__(
        self,
        settings: Settings,
        engine: Engine,
        clients: Dict[str, LLMClient],
        *,
        volume: int = 1,
        chapter_start: Optional[int] = None,
        chapter_end: Optional[int] = None,
        genre: str = "",
        requirements: str = "",
        batch_size: int = DEFAULT_BATCH,
        chapters_per_volume: int = 50,
        progress: Optional[ProgressFn] = None,
        override_existing: bool = False,
    ) -> None:
        self.settings = settings
        self.engine = engine
        self.clients = clients
        self.volume = max(1, int(volume))
        self.chapters_per_volume = max(1, int(chapters_per_volume))
        self.chapter_start = int(chapter_start) if chapter_start else (
            (self.volume - 1) * self.chapters_per_volume + 1
        )
        self.chapter_end = int(chapter_end) if chapter_end else (
            self.volume * self.chapters_per_volume
        )
        self.genre = genre
        self.requirements = requirements
        self.batch_size = max(1, min(int(batch_size or DEFAULT_BATCH), MAX_BATCH))
        self.progress = progress
        self.override_existing = override_existing
        self.result = PlanResult(volume=self.volume, status="failed")
        self._timings: Dict[str, int] = {}
        self._beats = ""
        self._timeline = ""

    # ---- 事件与计时 ----

    async def _emit(self, stage: str, status: str, message: str,
                    detail: Optional[Dict[str, Any]] = None,
                    duration_ms: int = 0) -> None:
        if self.progress is None:
            return
        await self.progress(StageEvent(
            stage=stage, status=status, message=message,
            detail=detail or {}, duration_ms=duration_ms,
        ))

    async def _timed(self, name: str, message: str,
                     fn: Callable[[], Awaitable[Any]]) -> Any:
        await self._emit(name, "running", message)
        import time as _time
        started = _time.monotonic()
        try:
            value = await fn()
        except (PipelineError, LLMError, EngineError):
            elapsed = int((_time.monotonic() - started) * 1000)
            await self._emit(name, "failed", f"{message} —— 失败", duration_ms=elapsed)
            raise
        elapsed = int((_time.monotonic() - started) * 1000)
        self._timings[name] = elapsed
        await self._emit(name, "ok", message, duration_ms=elapsed)
        return value

    def _client(self, role: str) -> LLMClient:
        # 规划复用 draft 角色的模型（若单独配了 plan 则优先）
        client = self.clients.get("plan") or self.clients.get("draft")
        if client is None:
            raise PipelineError(
                "规划需要配置 LLM（角色 `draft` 或 `plan`）。"
                "请通过 /service/config 或 .env 配置 base_url + model。",
                Stage.PREFLIGHT, recoverable=False,
            )
        return client

    # ---- 主流程 ----

    async def run(self) -> PlanResult:
        # 用显式标记记录是否发生硬失败，而不是靠初始 status 推断
        hard_failure = False
        try:
            await self._step_preflight()
            await self._step_volume()
            await self._step_chapters()
            await self._step_finalize()
        except PipelineError as exc:
            # 规划阶段的 PipelineError 都是"需要修配置/重跑"，不是用户裁决点，
            # 因此统一按失败处理（与写章 pipeline 对同类错误的处理一致）。
            self.result.problems.append(f"[{exc.stage.value}] {exc}")
            hard_failure = True
        except LLMError as exc:
            self.result.problems.append(f"LLM 调用失败：{exc}")
            hard_failure = True
        except EngineError as exc:
            self.result.problems.append(f"上游引擎失败：{exc}")
            hard_failure = True
        except Exception as exc:  # noqa: BLE001
            self.result.problems.append(f"未预期错误：{type(exc).__name__}: {exc}")
            hard_failure = True

        self.result.timings = dict(self._timings)

        # 状态判定：产物为准，宁可保守
        produced = bool(self.result.outline_file and self.result.chapters_planned)
        if hard_failure and not produced:
            self.result.status = "failed"
        elif self.result.problems or not produced:
            self.result.status = "partial" if produced else "failed"
        else:
            self.result.status = "completed"

        try:
            self.result.final_report = await asyncio.to_thread(
                self.engine.user_report, "plan", None, self.volume
            )
        except Exception:  # noqa: BLE001
            self.result.final_report = ""
        await self._emit("done", "ok", f"规划流程结束：{self.result.status}",
                         self.result.to_dict())
        return self.result

    # ---- 步骤 ----

    async def _step_preflight(self) -> None:
        async def _do() -> None:
            report = await asyncio.to_thread(self.engine.preflight)
            if not report.get("ok"):
                failed = [i for i in (report.get("checks") or []) if not i.get("ok")]
                raise PipelineError(
                    "预检未通过：" + ", ".join(str(i.get("name")) for i in failed),
                    Stage.PREFLIGHT,
                )
            if not self.genre:
                self.genre = await asyncio.to_thread(self.engine.resolve_genre)
            if not self.genre:
                raise PipelineError(
                    "无法确定题材（genre），规划需要它做节奏与命名匹配。"
                    "请显式传入 genre 或补齐 state.json。",
                    Stage.PREFLIGHT, recoverable=False,
                )
            self.result.auto_handled.append(f"题材：{self.genre}")

        await self._timed("preflight", "检查项目与题材", _do)

    async def _step_volume(self) -> None:
        async def _do() -> None:
            beats_rel = f"大纲/第{self.volume}卷-节拍表.md"
            timeline_rel = f"大纲/第{self.volume}卷-时间线.md"
            existing_beats = await asyncio.to_thread(self.engine.read_outline, beats_rel)
            existing_timeline = await asyncio.to_thread(self.engine.read_outline, timeline_rel)

            if existing_beats and existing_timeline and not self.override_existing:
                self._beats = existing_beats
                self._timeline = existing_timeline
                self.result.beats_file = str(Path(self.engine.project_root) / beats_rel)
                self.result.timeline_file = str(Path(self.engine.project_root) / timeline_rel)
                self.result.auto_handled.append("卷节拍表与时间线已存在，沿用未覆盖")
                return

            client = self._client("plan")
            master = await asyncio.to_thread(self.engine.master_outline)
            digest = await asyncio.to_thread(self.engine.settings_digest)

            base_prompt = prompts.build_plan_volume_prompt(
                self.volume, self.chapter_start, self.chapter_end,
                master, digest, self.genre, self.requirements,
            )

            # 与章纲批次同样的理由：单次调用失败不该丢掉整卷规划
            raw: Optional[Dict[str, Any]] = None
            last_error = ""
            attempts = max(1, self.settings.max_draft_retries + 1)
            for attempt in range(attempts):
                prompt = base_prompt
                if attempt > 0:
                    prompt = (
                        base_prompt
                        + f"\n\n# 上次输出不合格（{last_error}）\n"
                        "请严格只输出 JSON 对象，含 `volume_beats` 与 "
                        "`volume_timeline` 两个字符串键，不要输出解释文字。"
                    )
                try:
                    candidate = await client.complete_json(
                        prompts.PLAN_VOLUME_SYSTEM, prompt,
                        temperature=0.7 if attempt == 0 else 0.4,
                        max_tokens=16384,
                    )
                except LLMError as exc:
                    last_error = f"LLM 调用失败：{exc}"
                    continue
                if isinstance(candidate, dict) and (
                    str(candidate.get("volume_beats") or "").strip()
                    and str(candidate.get("volume_timeline") or "").strip()
                ):
                    raw = candidate
                    break
                last_error = "缺少 volume_beats / volume_timeline"
            if raw is None:
                raise PipelineError(
                    f"卷规划失败（已重试 {attempts} 次）：{last_error}",
                    Stage.CONTRACT,
                )
            if attempt > 0:
                self.result.auto_handled.append(
                    f"卷规划首次返回不合格，第 {attempt + 1} 次重试成功"
                )

            beats = str(raw.get("volume_beats") or "").strip()
            timeline = str(raw.get("volume_timeline") or "").strip()
            if not beats or not timeline:
                missing = [n for n, v in (("volume_beats", beats),
                                          ("volume_timeline", timeline)) if not v]
                raise PipelineError(
                    f"卷规划缺少内容：{', '.join(missing)}", Stage.CONTRACT
                )

            self._beats = beats
            self._timeline = timeline
            beats_path = await asyncio.to_thread(
                self.engine.save_outline, beats_rel, beats
            )
            timeline_path = await asyncio.to_thread(
                self.engine.save_outline, timeline_rel, timeline
            )
            self.result.beats_file = str(beats_path)
            self.result.timeline_file = str(timeline_path)

            # 硬要求自检：中段反转
            if "中段反转" not in beats:
                self.result.problems.append(
                    "卷节拍表缺少「中段反转」字段（上游硬要求：应填写，或写「无（理由：...）」）"
                )

        await self._timed("volume", f"生成第 {self.volume} 卷节拍表与时间线", _do)

    async def _step_chapters(self) -> None:
        async def _do() -> None:
            outline_rel = f"大纲/第{self.volume}卷-详细大纲.md"
            client = self._client("plan")

            # 已有章纲：按章节增量补齐，不覆盖已规划部分
            existing = await asyncio.to_thread(self.engine.read_outline, outline_rel)
            existing_sections: Dict[int, str] = {}
            if existing and not self.override_existing:
                existing_sections = self._split_sections(existing)
                if existing_sections:
                    self.result.auto_handled.append(
                        f"检测到已有 {len(existing_sections)} 章章纲，将增量补齐缺失章节"
                    )

            pending = [
                ch for ch in range(self.chapter_start, self.chapter_end + 1)
                if ch not in existing_sections
            ]
            if not pending:
                self.result.chapters_planned = sorted(existing_sections)
                self.result.outline_file = str(Path(self.engine.project_root) / outline_rel)
                self.result.auto_handled.append("全部章节章纲已存在，无需生成")
                return

            batches = [
                pending[i:i + self.batch_size]
                for i in range(0, len(pending), self.batch_size)
            ]
            collected: Dict[int, str] = dict(existing_sections)
            previous_cen = ""

            for index, batch in enumerate(batches, start=1):
                await self._emit(
                    "chapters", "running",
                    f"拆解章纲 第 {batch[0]}-{batch[-1]} 章"
                    f"（{index}/{len(batches)} 批）",
                )
                import time as _time
                started = _time.monotonic()
                base_prompt = prompts.build_plan_chapters_prompt(
                    self.volume, self.chapter_start, self.chapter_end,
                    self._beats, self._timeline, self.genre,
                    batch[0], batch[-1], previous_cen, self.requirements,
                )

                # 模型偶发返回空结构或不按 schema 输出。单次调用失败就丢掉整批
                # 太脆，所以按 max_draft_retries 重试，并在重试时追加纠正提示。
                entries: Optional[List[Any]] = None
                last_error = ""
                attempts = max(1, self.settings.max_draft_retries + 1)
                for attempt in range(attempts):
                    prompt = base_prompt
                    if attempt > 0:
                        prompt = (
                            base_prompt
                            + f"\n\n# 上次输出不合格（{last_error}）\n"
                            "请严格只输出 JSON 对象，顶层键为 `chapters`，"
                            "其值为数组，每项必须包含 chapter(int) 与 content(string)。"
                            "不要输出任何解释文字。"
                        )
                    try:
                        raw = await client.complete_json(
                            prompts.PLAN_CHAPTERS_SYSTEM, prompt,
                            temperature=0.7 if attempt == 0 else 0.4,
                            max_tokens=32768,
                        )
                    except LLMError as exc:
                        last_error = f"LLM 调用失败：{exc}"
                        continue

                    candidate = raw.get("chapters") if isinstance(raw, dict) else raw
                    if isinstance(candidate, list) and candidate:
                        entries = candidate
                        break
                    last_error = (
                        f"返回结构异常（{type(candidate).__name__}）"
                        if not isinstance(candidate, list)
                        else "chapters 为空数组"
                    )

                if entries is None:
                    self.result.problems.append(
                        f"第 {batch[0]}-{batch[-1]} 章拆解失败（已重试 {attempts} 次）：{last_error}"
                    )
                    continue
                if attempt > 0:
                    self.result.auto_handled.append(
                        f"第 {batch[0]}-{batch[-1]} 章首次返回不合格，第 {attempt + 1} 次重试成功"
                    )

                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    try:
                        num = int(entry.get("chapter"))
                    except (TypeError, ValueError):
                        continue
                    content = str(entry.get("content") or "").strip()
                    if not content:
                        continue
                    if num in collected and not self.override_existing:
                        continue
                    collected[num] = content

                # 记住本批最后一章的 CEN，供下一批承接
                last = batch[-1]
                if last in collected:
                    match = re.search(r"\*\*CEN\*\*\s*[:：]\s*(.+)", collected[last])
                    if match:
                        previous_cen = match.group(1).strip()

                elapsed = int((_time.monotonic() - started) * 1000)
                await self._emit(
                    "chapters", "ok",
                    f"已完成 第 {batch[0]}-{batch[-1]} 章",
                    duration_ms=elapsed,
                )

            if not collected:
                raise PipelineError(
                    "未能生成任何章纲。请检查模型输出或稍后重试。", Stage.CONTRACT
                )

            # 按章号排序拼装完整卷大纲
            parts = [
                f"# 第{self.volume}卷 详细大纲\n",
                f"\n> 覆盖第 {self.chapter_start}-{self.chapter_end} 章\n",
            ]
            for num in sorted(collected):
                parts.append("\n" + collected[num].strip() + "\n")
            merged = "\n".join(parts)

            path = await asyncio.to_thread(
                self.engine.save_outline, outline_rel, merged
            )
            self.result.outline_file = str(path)
            planned = sorted(collected)
            self.result.chapters_planned = planned

            missing = [
                ch for ch in range(self.chapter_start, self.chapter_end + 1)
                if ch not in collected
            ]
            if missing:
                self.result.problems.append(
                    f"有 {len(missing)} 章章纲未生成（前几个：{missing[:8]}）"
                )

        await self._timed("chapters", f"拆解第 {self.volume} 卷章纲", _do)

    @staticmethod
    def _split_sections(content: str) -> Dict[int, str]:
        """把卷大纲按 `### 第N章：标题` 拆成 {章号: 段落}。"""
        heading = re.compile(
            r"^#{1,6}\s*第\s*(?P<num>[0-9]+|[一二三四五六七八九十百]+)\s*章[：:].*$",
            re.MULTILINE,
        )
        matches = list(heading.finditer(content))
        out: Dict[int, str] = {}
        for index, match in enumerate(matches):
            num = Engine._parse_chapter_num(match.group("num"))
            if num is None:
                continue
            end = matches[index + 1].start() if index + 1 < len(matches) else len(content)
            out[num] = content[match.start():end].strip()
        return out

    async def _step_finalize(self) -> None:
        async def _do() -> None:
            # 刷新写作合同，让写章阶段直接可用（对应上游 plan Step 10）
            if not self.result.chapters_planned:
                return
            first = self.result.chapters_planned[0]
            first_text = await asyncio.to_thread(
                self.engine.chapter_outline, first
            )
            goal = ""
            if first_text:
                match = re.search(r"\*\*目标\*\*\s*[:：]\s*(.+)", first_text)
                if match:
                    goal = match.group(1).strip()
                elif first_text.strip():
                    for line in first_text.splitlines():
                        stripped = line.strip().lstrip("#").strip()
                        if stripped and not stripped.startswith("**"):
                            goal = stripped[:200]
                            break
            if not goal:
                self.result.problems.append("无法从首章章纲解析目标，跳过合同刷新")
                return
            try:
                res = await asyncio.to_thread(
                    self.engine.story_system, goal, self.genre, first, True
                )
                if res.ok:
                    self.result.auto_handled.append(
                        f"已刷新第 {first} 章写作合同，可直接开始写作"
                    )
                else:
                    self.result.problems.append(
                        f"合同刷新失败：{(res.stderr or res.stdout).strip()[:300]}"
                    )
            except EngineError as exc:
                self.result.problems.append(f"合同刷新失败：{exc}")

            # 更新项目状态（卷已规划）
            try:
                await asyncio.to_thread(
                    self.engine.update_state,
                    "--volume-planned", str(self.volume),
                    "--chapters-range",
                    f"{self.chapter_start}-{self.chapter_end}",
                )
            except EngineError:
                self.result.auto_handled.append("状态更新跳过（不影响章纲文件）")

        await self._timed("finalize", "刷新写作合同与项目状态", _do)
