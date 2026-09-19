# -*- coding: utf-8 -*-
"""FastAPI 应用：写操作 API + 配置 API，并复用上游 Dashboard 的只读层。

路由策略（重要）：
- 上游 `dashboard/app.py` 的 `create_app()` 带 SPA 兜底路由 `/{full_path:path}`，
  会吞掉所有未匹配路径。所以必须**先注册本层的路由**，最后才挂载上游应用。
- 上游应用提供 30 个只读 `/api/*` 端点与预构建前端，直接白拿。

写操作一律显式：POST/PUT，且不碰上游目录。
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import (
    ROLES,
    SERVICE_ROOT,
    UPSTREAM_ROOT,
    load_settings,
    save_runtime_settings,
)
from .engine import Engine, EngineError
from .llm import LLMError, build_clients
from .pipeline import WritePipeline

# 允许写操作的前端来源
CORS_ORIGINS = [
    "http://localhost",
    "http://localhost:5173",
    "http://localhost:8000",
    "http://127.0.0.1",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
]


def _engine_or_raise(project_root: Optional[str] = None) -> Engine:
    settings = load_settings(project_root)
    root = project_root or settings.project_root
    if not root:
        raise HTTPException(400, "未指定 book project_root（请通过 body 传入或先初始化项目）")
    return Engine(settings, project_root=root)


def create_service_app(default_project_root: Optional[str] = None) -> FastAPI:
    app = FastAPI(
        title="Webnovel Writer Service",
        version="0.1.0",
        description=(
            "webnovel-writer 的服务化封装：可配置 LLM API 的长篇网文创作服务。"
            "写操作在本层；只读查询与可视化面板复用上游 Dashboard。"
        ),
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["*"],
    )

    # ─────────────────────────────────────────────────────────────
    # 健康与版本
    # ─────────────────────────────────────────────────────────────

    @app.get("/service/health", tags=["service"])
    def health() -> Dict[str, Any]:
        settings = load_settings(default_project_root)
        configured = [role for role in ROLES[:4] if settings.role(role).is_usable()]
        return {
            "ok": True,
            "upstream_root": str(UPSTREAM_ROOT),
            "upstream_present": (UPSTREAM_ROOT / "scripts" / "webnovel.py").is_file(),
            "llm_roles_configured": configured,
            "project_root": settings.project_root or default_project_root or "",
        }

    # ─────────────────────────────────────────────────────────────
    # 配置 API —— "可以配置 api" 的落点
    # ─────────────────────────────────────────────────────────────

    @app.get("/service/config", tags=["config"])
    def get_config() -> Dict[str, Any]:
        """返回生效配置。api_key 只回显是否已设置与末四位。"""
        return load_settings(default_project_root).to_public_dict()

    @app.put("/service/config", tags=["config"])
    def put_config(patch: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
        """写入运行时配置（合并语义）。api_key 传空字符串表示不改动。"""
        save_runtime_settings(patch)
        return load_settings(default_project_root).to_public_dict()

    @app.post("/service/config/test", tags=["config"])
    async def test_config(
        payload: Dict[str, Any] = Body(default_factory=dict),
    ) -> Dict[str, Any]:
        """连通性测试：跑一次最小 LLM 调用。可临时覆盖 base_url/model/api_key。"""
        settings = load_settings(default_project_root)
        role = str(payload.get("role") or "draft")
        try:
            role_cfg = settings.role(role)
        except Exception:  # noqa: BLE001
            role_cfg = None
        if role_cfg is None:
            raise HTTPException(400, f"未知角色：{role}")

        # 临时覆盖（仅本次调用，不落盘）
        if payload.get("base_url"):
            role_cfg.base_url = str(payload["base_url"])
        if payload.get("model"):
            role_cfg.model = str(payload["model"])
        if payload.get("api_key"):
            role_cfg.api_key = str(payload["api_key"])
        if payload.get("api"):
            role_cfg.api = str(payload["api"])

        from .llm import LLMClient

        try:
            client = LLMClient(role_cfg, role_name=role)
        except LLMError as exc:
            return {"ok": False, "role": role, "error": str(exc)}
        try:
            result = await client.complete(
                "You are a connectivity probe.",
                "Reply with exactly: OK",
                temperature=0,
                max_tokens=16,
            )
        except LLMError as exc:
            return {"ok": False, "role": role, "error": str(exc)}
        return {
            "ok": True,
            "role": role,
            "model": result.model,
            "sample": result.text.strip()[:120],
            "usage": result.usage,
        }

    # ─────────────────────────────────────────────────────────────
    # 项目生命周期
    # ─────────────────────────────────────────────────────────────

    @app.post("/service/projects", tags=["project"])
    async def create_project(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
        """初始化一本新书。body: {project_dir, title, genre, protagonist_name, ...}"""
        project_dir = str(payload.get("project_dir") or "").strip()
        title = str(payload.get("title") or "").strip()
        if not project_dir or not title:
            raise HTTPException(400, "project_dir 与 title 必填")

        settings = load_settings(default_project_root)
        engine = Engine(settings, project_root=None)  # init 不需要已有项目
        options = {key: value for key, value in payload.items()
                   if key not in ("project_dir", "title", "genre")}
        try:
            res = await asyncio.to_thread(
                engine.init_project, project_dir, title,
                str(payload.get("genre") or ""), **options
            )
        except EngineError as exc:
            raise HTTPException(500, f"初始化失败：{exc}") from exc
        if not res.ok:
            raise HTTPException(
                500, f"初始化失败（exit {res.returncode}）：{res.stderr.strip()[:800]}"
            )

        resolved = Path(project_dir).resolve()
        return {
            "ok": True,
            "project_root": str(resolved),
            "state_exists": (resolved / ".webnovel" / "state.json").is_file(),
            "stdout": res.stdout.strip()[:2000],
        }

    @app.get("/service/projects/status", tags=["project"])
    async def project_status(
        project_root: Optional[str] = Query(default=None),
        chapter: Optional[int] = Query(default=None),
    ) -> Any:
        engine = _engine_or_raise(project_root or default_project_root)
        try:
            return await asyncio.to_thread(engine.project_status, chapter)
        except EngineError as exc:
            raise HTTPException(500, str(exc)) from exc

    @app.get("/service/projects/doctor", tags=["project"])
    async def project_doctor(
        project_root: Optional[str] = Query(default=None),
        chapter: Optional[int] = Query(default=None),
        deep: bool = Query(default=False),
    ) -> Any:
        engine = _engine_or_raise(project_root or default_project_root)
        try:
            return await asyncio.to_thread(engine.doctor, chapter, deep)
        except EngineError as exc:
            raise HTTPException(500, str(exc)) from exc

    @app.get("/service/projects/resume", tags=["project"])
    async def write_resume(
        chapter: int = Query(...),
        project_root: Optional[str] = Query(default=None),
        mode: str = Query(default="default"),
    ) -> Any:
        """可信断点查询：从哪一步继续。"""
        engine = _engine_or_raise(project_root or default_project_root)
        try:
            return await asyncio.to_thread(engine.write_resume, chapter, mode)
        except EngineError as exc:
            raise HTTPException(500, str(exc)) from exc

    # ─────────────────────────────────────────────────────────────
    # 写章
    # ─────────────────────────────────────────────────────────────

    def _build_pipeline(
        engine: Engine,
        payload: Dict[str, Any],
        progress=None,
    ) -> WritePipeline:
        settings = load_settings(engine.project_root)
        clients = build_clients(settings)
        return WritePipeline(
            settings, engine, clients,
            mode=str(payload.get("mode") or "default"),
            target_words=payload.get("target_words"),
            chapter_title=str(payload.get("title") or ""),
            chapter_goal=str(payload.get("chapter_goal") or ""),
            genre=str(payload.get("genre") or ""),
            progress=progress,
            stop_after_review=bool(payload.get("stop_after_review")),
            override_existing=bool(payload.get("override_existing")),
        )

    @app.post("/service/write", tags=["write"])
    async def write_chapter(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
        """同步写一章。耗时较长，前端建议用 /service/write/stream。"""
        chapter = payload.get("chapter")
        if not chapter:
            raise HTTPException(400, "chapter 必填")
        engine = _engine_or_raise(payload.get("project_root") or default_project_root)
        pipeline = _build_pipeline(engine, payload)
        result = await pipeline.run(int(chapter))
        return result.to_dict()

    @app.post("/service/write/stream", tags=["write"])
    async def write_chapter_stream(payload: Dict[str, Any] = Body(...)) -> StreamingResponse:
        """SSE 流式写章：实时推送阶段进度，最后推 final 事件。"""
        chapter = payload.get("chapter")
        if not chapter:
            raise HTTPException(400, "chapter 必填")
        engine = _engine_or_raise(payload.get("project_root") or default_project_root)

        queue: asyncio.Queue = asyncio.Queue()

        async def _progress(event) -> None:
            await queue.put(("progress", event.to_dict()))

        async def _worker() -> None:
            try:
                pipeline = _build_pipeline(engine, payload, progress=_progress)
                result = await pipeline.run(int(chapter))
                await queue.put(("final", result.to_dict()))
            except Exception as exc:  # noqa: BLE001 - 必须把错误推给前端
                await queue.put(("error", {"message": f"{type(exc).__name__}: {exc}"}))
            finally:
                await queue.put(("__end__", None))

        async def _gen():
            task = asyncio.create_task(_worker())
            try:
                while True:
                    kind, data = await queue.get()
                    if kind == "__end__":
                        break
                    yield f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
            except asyncio.CancelledError:
                task.cancel()
                raise
            finally:
                if not task.done():
                    task.cancel()

        return StreamingResponse(
            _gen(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ─────────────────────────────────────────────────────────────
    # 只读查询（写操作之外，仍走本层以便统一 project_root）
    # ─────────────────────────────────────────────────────────────

    @app.get("/service/chapters/{chapter}", tags=["read"])
    async def get_chapter(
        chapter: int,
        project_root: Optional[str] = Query(default=None),
    ) -> Dict[str, Any]:
        engine = _engine_or_raise(project_root or default_project_root)
        path = await asyncio.to_thread(engine.chapter_file, chapter)
        if path is None:
            raise HTTPException(404, f"第 {chapter} 章正文尚未生成")
        return {
            "chapter": chapter,
            "path": str(path),
            "name": path.name,
            "content": path.read_text(encoding="utf-8"),
            "word_count": len(path.read_text(encoding="utf-8")),
        }

    @app.get("/service/context/{chapter}", tags=["read"])
    async def get_context(
        chapter: int,
        project_root: Optional[str] = Query(default=None),
    ) -> Any:
        engine = _engine_or_raise(project_root or default_project_root)
        try:
            return await asyncio.to_thread(engine.load_context, chapter)
        except EngineError as exc:
            raise HTTPException(500, str(exc)) from exc

    @app.get("/service/events", tags=["read"])
    async def story_events(
        chapter: int = Query(default=0),
        limit: int = Query(default=200),
        health: bool = Query(default=False),
        project_root: Optional[str] = Query(default=None),
    ) -> Any:
        engine = _engine_or_raise(project_root or default_project_root)
        try:
            return await asyncio.to_thread(engine.story_events, chapter, limit, health)
        except EngineError as exc:
            raise HTTPException(500, str(exc)) from exc

    # ─────────────────────────────────────────────────────────────
    # 复用上游 Dashboard 的只读 API 与前端（必须最后挂载）
    # ─────────────────────────────────────────────────────────────

    upstream_app = _load_upstream_dashboard(default_project_root)
    if upstream_app is not None:
        app.mount("/", upstream_app, name="dashboard")

    return app


def _load_upstream_dashboard(project_root: Optional[str]) -> Optional[FastAPI]:
    """导入并构造上游 Dashboard app。失败时返回 None（服务仍可用）。"""
    dashboard_dir = UPSTREAM_ROOT / "dashboard"
    if not dashboard_dir.is_dir():
        print("warn: 未找到上游 dashboard 目录，只读面板不可用", file=sys.stderr)
        return None
    # 上游包用相对导入（from .path_guard import ...），必须以包方式导入
    if str(UPSTREAM_ROOT) not in sys.path:
        sys.path.insert(0, str(UPSTREAM_ROOT))
    try:
        from dashboard.app import create_app as create_dashboard  # type: ignore
    except Exception as exc:  # noqa: BLE001 - 面板不可用不应阻塞服务
        print(f"warn: 加载上游 dashboard 失败：{exc}", file=sys.stderr)
        return None
    try:
        return create_dashboard(project_root)
    except Exception as exc:  # noqa: BLE001
        print(f"warn: 构造上游 dashboard 失败：{exc}", file=sys.stderr)
        return None


# 供 `uvicorn service.app:app` 直接使用
app = create_service_app()
