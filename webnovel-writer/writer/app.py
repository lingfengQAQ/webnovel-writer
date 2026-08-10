from __future__ import annotations

import secrets
from pathlib import Path
from typing import Any

from fastapi import Depends, HTTPException, Query, Request, Response
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import StreamingResponse

from dashboard.app import configure_project_root, create_app as create_dashboard_app

from .models import DraftUpdate, FinalizeRequest, SettingsUpdate, WorkflowAction, WorkflowRequest
from .secrets import SecretStoreError, set_api_key
from .service import WriterService
from .storage import WriterStore


def create_writer_app(project_root: str | Path, *, store: WriterStore | None = None):
    root = Path(project_root).expanduser().resolve()
    app = create_dashboard_app(root)
    app.title = "Webnovel Writer Client"
    app.version = "0.1.0"
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "testserver"])
    service = WriterService(root, store=store)
    sessions: dict[str, str] = {}

    def _error(exc: Exception, status: int = 400) -> HTTPException:
        return HTTPException(status_code=status, detail=str(exc))

    def require_csrf(request: Request) -> None:
        session_id = request.cookies.get("webnovel_writer_session", "")
        supplied = request.headers.get("X-CSRF-Token", "")
        expected = sessions.get(session_id, "")
        if not session_id or not supplied or not secrets.compare_digest(supplied, expected):
            raise HTTPException(status_code=403, detail="CSRF validation failed")

    @app.get("/api/writer/capabilities")
    def capabilities(response: Response):
        if len(sessions) >= 100:
            sessions.clear()
        session_id = secrets.token_urlsafe(24)
        csrf = secrets.token_urlsafe(24)
        sessions[session_id] = csrf
        response.set_cookie(
            "webnovel_writer_session", session_id, httponly=True, samesite="strict", secure=False,
        )
        active = Path(service.project_root)
        workspace = active.parent if (active / ".webnovel" / "state.json").is_file() else active
        return {
            "writer": True,
            "project_root": service.project_root,
            "workspace_root": str(workspace),
            "csrf_token": csrf,
            "features": ["init", "plan", "write", "review", "revise", "finalize", "cache_metrics"],
        }

    @app.get("/api/writer/settings")
    def get_settings():
        return service.config().model_dump()

    @app.put("/api/writer/settings", dependencies=[Depends(require_csrf)])
    def put_settings(body: SettingsUpdate):
        service.store.save_settings(body.model_dump(exclude={"api_key"}))
        if body.api_key:
            try:
                set_api_key(body.api_key)
            except SecretStoreError as exc:
                raise _error(exc) from exc
        return service.config().model_dump()

    @app.post("/api/writer/settings/test", dependencies=[Depends(require_csrf)])
    async def test_settings():
        cfg = service.config()
        try:
            content, usage = await service.client().complete(
                messages=[{"role": "user", "content": "只回复 OK"}], model=cfg.fast_model, thinking=False,
                max_tokens=8, task="connection_test", project_root=service.project_root,
                prefix_id="connection-test", is_warmup=True,
            )
            return {"ok": content.upper().startswith("OK"), "model": cfg.fast_model, "latency_ms": usage["latency_ms"]}
        except Exception as exc:
            raise _error(exc, 502) from exc

    @app.post("/api/writer/workflows", dependencies=[Depends(require_csrf)])
    async def create_workflow(body: WorkflowRequest):
        try:
            return await service.start(body)
        except Exception as exc:
            raise _error(exc) from exc

    @app.get("/api/writer/workflows")
    def list_workflows(limit: int = Query(30, ge=1, le=100)):
        return service.store.list_workflows(service.project_root, limit)

    @app.get("/api/writer/workflows/{workflow_id}")
    def get_workflow(workflow_id: str):
        result = service.store.get_workflow(workflow_id)
        if not result:
            raise HTTPException(404, "workflow not found")
        return result

    @app.post("/api/writer/workflows/{workflow_id}/actions", dependencies=[Depends(require_csrf)])
    async def workflow_action(workflow_id: str, body: WorkflowAction):
        try:
            result = await service.action(workflow_id, body.action, body.payload)
            initialized = (result.get("result") or {}).get("initialized") or {}
            if initialized.get("project_root"):
                configure_project_root(initialized["project_root"])
            return result
        except KeyError as exc:
            raise _error(exc, 404) from exc
        except Exception as exc:
            raise _error(exc) from exc

    @app.get("/api/writer/drafts/{chapter}")
    def get_draft(chapter: int):
        result = service.store.get_draft(service.project_root, chapter)
        if not result:
            raise HTTPException(404, "draft not found")
        return result

    @app.put("/api/writer/drafts/{chapter}", dependencies=[Depends(require_csrf)])
    def put_draft(chapter: int, body: DraftUpdate):
        try:
            return service.store.save_draft(service.project_root, chapter, body.content, body.base_revision)
        except ValueError as exc:
            raise _error(exc, 409) from exc

    @app.post("/api/writer/drafts/{chapter}/finalize", dependencies=[Depends(require_csrf)])
    async def finalize(chapter: int, body: FinalizeRequest):
        try:
            return await service.finalize(service.project_root, chapter, body.expected_revision)
        except ValueError as exc:
            raise _error(exc, 409) from exc
        except Exception as exc:
            raise _error(exc) from exc

    @app.get("/api/writer/usage")
    def usage(limit: int = Query(20, ge=1, le=200)):
        return service.store.usage_summary(service.project_root, limit)

    @app.get("/api/writer/events")
    async def writer_events():
        return StreamingResponse(service.events(), media_type="text/event-stream")

    # Dashboard 的 SPA fallback 是一个 GET catch-all。Writer 路由在组合应用时后注册，
    # 必须移到 fallback 之前，否则 /api/writer/* GET 会被当成 index.html。
    writer_routes = [route for route in app.router.routes if getattr(route, "path", "").startswith("/api/writer")]
    remaining = [route for route in app.router.routes if route not in writer_routes]
    fallback_index = next(
        (index for index, route in enumerate(remaining) if getattr(route, "path", "") == "/{full_path:path}"),
        len(remaining),
    )
    app.router.routes[:] = remaining[:fallback_index] + writer_routes + remaining[fallback_index:]

    app.state.writer_service = service
    return app
