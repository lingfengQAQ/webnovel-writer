from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, AsyncIterator

from .deepseek import DeepSeekClient, DeepSeekError
from .models import (
    CommitArtifactsPayload,
    IdeaOptionsPayload,
    PlanPayload,
    ProviderConfig,
    ReviewPayload,
    WorkflowRequest,
)
from .prompts import (
    build_common_context,
    canonical_json,
    latest_story_context,
    prefix_id,
    review_instruction,
    task_messages,
    warmup_messages,
)
from .runtime import apply_plan, finalize_draft, initialize_project
from .secrets import get_api_key
from .storage import WriterStore


class WriterService:
    def __init__(self, project_root: str | Path | None, store: WriterStore | None = None):
        self.project_root = str(Path(project_root).resolve()) if project_root else ""
        self.store = store or WriterStore()
        self._tasks: dict[str, asyncio.Task] = {}
        self._subscribers: set[asyncio.Queue] = set()

    def config(self) -> ProviderConfig:
        stored = self.store.get_settings()
        return ProviderConfig(
            base_url=stored.get("base_url", "https://api.deepseek.com"),
            fast_model=stored.get("fast_model", "deepseek-v4-flash"),
            deep_model=stored.get("deep_model", "deepseek-v4-pro"),
            timeout_seconds=int(stored.get("timeout_seconds", 180)),
            api_key_present=bool(get_api_key()),
        )

    def client(self) -> DeepSeekClient:
        return DeepSeekClient(self.config(), get_api_key(), self.store)

    def resolve_root(self, requested: str | None = None, *, require_project: bool = True) -> str:
        raw = requested or self.project_root
        if not raw:
            if require_project:
                raise ValueError("未选择小说项目")
            return ""
        root = Path(raw).expanduser().resolve()
        if require_project and not (root / ".webnovel" / "state.json").is_file():
            raise ValueError(f"不是有效小说项目: {root}")
        return str(root)

    async def publish(self, event: dict[str, Any]) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                pass

    async def events(self) -> AsyncIterator[str]:
        queue: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._subscribers.add(queue)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20)
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            self._subscribers.discard(queue)

    async def _set(self, workflow_id: str, **changes: Any) -> dict[str, Any]:
        record = self.store.update_workflow(workflow_id, **changes)
        await self.publish({"type": "workflow", "workflow": record})
        return record

    async def start(self, request: WorkflowRequest) -> dict[str, Any]:
        root = self.resolve_root(request.project_root, require_project=request.type != "init")
        if request.type == "init":
            root = str(Path(request.project_root or request.payload.get("workspace_root") or Path.cwd()).resolve())
        workflow_id = uuid.uuid4().hex
        record = self.store.create_workflow({
            "id": workflow_id, "type": request.type, "project_root": root,
            "request": request.model_dump(),
        })
        task = asyncio.create_task(self._run(workflow_id))
        self._tasks[workflow_id] = task
        task.add_done_callback(lambda _: self._tasks.pop(workflow_id, None))
        return record

    async def _run(self, workflow_id: str) -> None:
        record = self.store.get_workflow(workflow_id)
        if not record:
            return
        req = WorkflowRequest.model_validate(record["request"])
        try:
            await self._set(workflow_id, status="running", stage="preparing", progress=5, error="")
            if req.type == "init":
                await self._run_init(workflow_id, req)
            elif req.type == "plan":
                await self._run_plan(workflow_id, req)
            elif req.type == "write":
                await self._run_write(workflow_id, req)
            elif req.type == "review":
                await self._run_review(workflow_id, req)
            elif req.type == "revise":
                await self._run_revise(workflow_id, req)
        except asyncio.CancelledError:
            await self._set(workflow_id, status="cancelled", stage="cancelled")
        except Exception as exc:
            await self._set(workflow_id, status="failed", stage="failed", error=str(exc))

    async def _prefix(self, project_root: str, chapter: int | None, model: str, workflow_id: str) -> tuple[dict[str, Any], str, str]:
        common = build_common_context(project_root, chapter) if (Path(project_root) / ".story-system").is_dir() else {
            "prompt_version": "writer-client/v1", "project_setup": "new_project"
        }
        identity = prefix_id(model, common)
        cached = self.store.get_prefix(identity)
        stale = True
        if cached:
            try:
                last_used = datetime.fromisoformat(cached["last_used_at"])
                stale = datetime.now(timezone.utc) - last_used > timedelta(hours=2) or int(cached["low_hit_streak"]) >= 3
            except (ValueError, TypeError):
                stale = True
        if stale:
            content, _ = await self.client().complete(
                messages=warmup_messages(common), model=model, thinking=False, max_tokens=16,
                task="cache_warmup", project_root=project_root, prefix_id=identity,
                workflow_id=workflow_id, is_warmup=True,
            )
            acknowledgement = content if content else "CACHE_READY"
            self.store.save_prefix(identity, model, common, acknowledgement)
        else:
            acknowledgement = str(cached["acknowledgement"])
        return common, acknowledgement, identity

    def _touch_usage(self, identity: str, usage: dict[str, Any]) -> None:
        hit = int(usage.get("prompt_cache_hit_tokens") or 0)
        miss = int(usage.get("prompt_cache_miss_tokens") or 0)
        self.store.touch_prefix(identity, hit / (hit + miss) if hit + miss else 0.0)

    async def _run_init(self, workflow_id: str, req: WorkflowRequest) -> None:
        cfg = self.config()
        common, ack, identity = await self._prefix(req.project_root or req.payload.get("workspace_root") or str(Path.cwd()), None, cfg.deep_model, workflow_id)
        dynamic = {
            "task": "generate_novel_ideas", "requirements": "根据用户资料生成 2 到 3 个差异化中文网文创意，输出 JSON。",
            "json_schema": {"candidates": [
                {"title": "方案一", "one_liner": "", "anti_trope": "", "hard_constraints": [], "opening_hook": ""},
                {"title": "方案二", "one_liner": "", "anti_trope": "", "hard_constraints": [], "opening_hook": ""},
            ]},
            "user_input": req.payload,
        }
        result, usage = await self.client().complete_json(
            IdeaOptionsPayload, messages=task_messages(common, ack, dynamic), model=cfg.deep_model,
            thinking=True, task="init", project_root=str(req.project_root or req.payload.get("workspace_root") or Path.cwd()),
            prefix_id=identity, workflow_id=workflow_id,
        )
        self._touch_usage(identity, usage)
        await self._set(workflow_id, status="awaiting_user", stage="choose_idea", progress=45, result=result.model_dump())

    async def _run_plan(self, workflow_id: str, req: WorkflowRequest) -> None:
        root = self.resolve_root(req.project_root)
        cfg = self.config()
        start = int(req.payload.get("start_chapter") or req.chapter or 1)
        end = int(req.payload.get("end_chapter") or start)
        volume = int(req.volume or req.payload.get("volume") or ((start - 1) // 50 + 1))
        common, ack, identity = await self._prefix(root, start, cfg.deep_model, workflow_id)
        dynamic = {
            **latest_story_context(root, start), "task": "plan_volume_and_chapters", "volume": volume,
            "start_chapter": start, "end_chapter": end, "instruction": req.instruction,
            "requirements": "生成可执行卷纲 Markdown 和每章一句完整写作目标。每章必须使用二级标题“## 第N章 标题”，并逐行包含“目标：”“cbn：”“cpns：”“cen：”“必须覆盖节点：”“本章禁区：”“章末问题：”。输出 JSON；chapter_queries 的键为章节数字字符串，必须覆盖完整范围。",
            "json_schema": {"volume": volume, "start_chapter": start, "end_chapter": end,
                            "volume_outline_markdown": "", "chapter_queries": {str(start): ""}},
        }
        plan, usage = await self.client().complete_json(
            PlanPayload, messages=task_messages(common, ack, dynamic), model=cfg.deep_model, thinking=True,
            task="plan", project_root=root, prefix_id=identity, workflow_id=workflow_id,
        )
        self._touch_usage(identity, usage)
        await self._set(workflow_id, status="awaiting_user", stage="approve_plan", progress=60, result=plan.model_dump())

    async def _run_write(self, workflow_id: str, req: WorkflowRequest) -> None:
        from data_modules.write_gates import run_write_gate

        root = self.resolve_root(req.project_root)
        chapter = int(req.chapter or 0)
        gate = run_write_gate(root, chapter=chapter, stage="prewrite")
        if not gate["ok"]:
            raise ValueError("prewrite gate 未通过: " + json.dumps(gate["errors"], ensure_ascii=False))
        cfg = self.config()
        common, ack, identity = await self._prefix(root, chapter, cfg.fast_model, workflow_id)
        dynamic = {
            **latest_story_context(root, chapter), "task": "write_chapter", "instruction": req.instruction,
            "requirements": "直接输出完整中文章节正文，不要解释、不要 Markdown 代码块。",
        }

        collected: list[str] = []
        async def on_delta(delta: str) -> None:
            collected.append(delta)
            await self.publish({"type": "text_delta", "workflow_id": workflow_id, "delta": delta})

        content, usage = await self.client().stream(
            on_delta=on_delta, messages=task_messages(common, ack, dynamic), model=cfg.fast_model,
            thinking=False, task="write", project_root=root, prefix_id=identity, workflow_id=workflow_id,
        )
        self._touch_usage(identity, usage)
        draft = self.store.save_draft(root, chapter, content)
        await self._set(workflow_id, status="awaiting_user", stage="edit_draft", progress=65,
                        result={"chapter": chapter, "draft": draft})

    async def _run_review(self, workflow_id: str, req: WorkflowRequest) -> None:
        root = self.resolve_root(req.project_root)
        chapter = int(req.chapter or 0)
        draft = self.store.get_draft(root, chapter)
        if not draft:
            raise ValueError("尚无客户端草稿")
        cfg = self.config()
        common, ack, identity = await self._prefix(root, chapter, cfg.deep_model, workflow_id)
        review, usage = await self.client().complete_json(
            ReviewPayload, messages=task_messages(common, ack, {**latest_story_context(root, chapter), **review_instruction(chapter, draft["content"])}),
            model=cfg.deep_model, thinking=True, task="review", project_root=root, prefix_id=identity, workflow_id=workflow_id,
        )
        self._touch_usage(identity, usage)
        updated = self.store.mark_reviewed(root, chapter, review.model_dump())
        await self._set(workflow_id, status="completed", stage="reviewed", progress=100,
                        result={"chapter": chapter, "draft": updated, "review": review.model_dump()})

    async def _run_revise(self, workflow_id: str, req: WorkflowRequest) -> None:
        root = self.resolve_root(req.project_root)
        chapter = int(req.chapter or 0)
        draft = self.store.get_draft(root, chapter)
        if not draft:
            raise ValueError("尚无客户端草稿")
        cfg = self.config()
        common, ack, identity = await self._prefix(root, chapter, cfg.fast_model, workflow_id)
        dynamic = {**latest_story_context(root, chapter), "task": "revise_chapter", "instruction": req.instruction,
                   "requirements": "根据要求修改全文，直接输出修改后的完整正文。", "content": draft["content"], "review": draft["review"]}
        async def on_delta(delta: str) -> None:
            await self.publish({"type": "text_delta", "workflow_id": workflow_id, "delta": delta})
        content, usage = await self.client().stream(
            on_delta=on_delta, messages=task_messages(common, ack, dynamic), model=cfg.fast_model, thinking=False,
            task="revise", project_root=root, prefix_id=identity, workflow_id=workflow_id,
        )
        self._touch_usage(identity, usage)
        updated = self.store.save_draft(root, chapter, content, int(draft["revision"]))
        await self._set(workflow_id, status="awaiting_user", stage="edit_draft", progress=70,
                        result={"chapter": chapter, "draft": updated})

    async def action(self, workflow_id: str, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        record = self.store.get_workflow(workflow_id)
        if not record:
            raise KeyError(workflow_id)
        if action == "cancel":
            task = self._tasks.get(workflow_id)
            if task:
                task.cancel()
            return await self._set(workflow_id, status="cancelled", stage="cancelled")
        if action in {"retry", "resume"}:
            if workflow_id in self._tasks:
                raise ValueError("任务仍在运行")
            task = asyncio.create_task(self._run(workflow_id))
            self._tasks[workflow_id] = task
            task.add_done_callback(lambda _: self._tasks.pop(workflow_id, None))
            return await self._set(workflow_id, status="queued", stage="queued", progress=0, error="")
        if action != "confirm" or record["status"] != "awaiting_user":
            raise ValueError("当前任务不能执行该操作")
        if record["type"] == "plan":
            result = apply_plan(record["project_root"], record["result"])
            return await self._set(workflow_id, status="completed", stage="plan_applied", progress=100,
                                   result={**record["result"], "applied": result})
        if record["type"] == "init":
            candidates = record["result"].get("candidates") or []
            index = int(payload.get("candidate_index", 0))
            if index < 0 or index >= len(candidates):
                raise ValueError("创意候选索引无效")
            request_payload = (record["request"].get("payload") or {})
            result = initialize_project(record["project_root"], request_payload, candidates[index])
            self.project_root = result["project_root"]
            return await self._set(workflow_id, status="completed", stage="initialized", progress=100,
                                   result={**record["result"], "selected": candidates[index], "initialized": result})
        raise ValueError("该工作流无需 confirm；正文请使用定稿接口")

    async def finalize(self, project_root: str, chapter: int, expected_revision: int) -> dict[str, Any]:
        root = self.resolve_root(project_root)
        draft = self.store.get_draft(root, chapter)
        if not draft:
            raise ValueError("草稿不存在")
        if int(draft["revision"]) != expected_revision:
            raise ValueError(f"草稿版本冲突，当前版本为 {draft['revision']}")
        if draft["reviewed_sha256"] != draft["sha256"]:
            raise ValueError("正文在审查后发生变化，请重新审查")
        review = draft.get("review") or {}
        if int(review.get("blocking_count") or 0) > 0:
            raise ValueError("仍有阻断问题，请修改并重新审查")
        workflow_id = uuid.uuid4().hex
        cfg = self.config()
        common, ack, identity = await self._prefix(root, chapter, cfg.fast_model, workflow_id)
        dynamic = {
            **latest_story_context(root, chapter), "task": "extract_commit_artifacts",
            "requirements": "从正文提取可提交事实并核对章纲履约。只输出 JSON；不要虚构未发生事实。",
            "json_schema": {"planned_nodes": [], "covered_nodes": [], "missed_nodes": [], "extra_nodes": [],
                            "pending_disambiguation": [], "extraction": {"accepted_events": [], "state_deltas": [],
                            "entity_deltas": [], "entities_appeared": [], "scenes": [], "chapter_meta": {},
                            "dominant_strand": "", "summary_text": ""}},
            "content": draft["content"],
        }
        artifacts, usage = await self.client().complete_json(
            CommitArtifactsPayload, messages=task_messages(common, ack, dynamic), model=cfg.fast_model, thinking=False,
            task="extract", project_root=root, prefix_id=identity, workflow_id=workflow_id,
        )
        self._touch_usage(identity, usage)
        return finalize_draft(root, chapter=chapter, content=draft["content"], review=review, artifacts=artifacts.model_dump())
