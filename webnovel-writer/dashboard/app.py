"""
Webnovel Dashboard - FastAPI 主应用

仅提供 GET 接口（严格只读）；所有文件读取经过 path_guard 防穿越校验。
"""

import asyncio
import json
import os
import sqlite3
import time
from contextlib import asynccontextmanager, closing
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from .path_guard import safe_resolve
from .watcher import FileWatcher

# ---------------------------------------------------------------------------
# 全局状态
# ---------------------------------------------------------------------------
_project_root: Path | None = None
_watcher = FileWatcher()

STATIC_DIR = Path(__file__).parent / "frontend" / "dist"


def _get_project_root() -> Path:
    if _project_root is None:
        raise HTTPException(status_code=500, detail="项目根目录未配置")
    return _project_root


def _webnovel_dir() -> Path:
    return _get_project_root() / ".webnovel"


# ---------------------------------------------------------------------------
# 应用工厂
# ---------------------------------------------------------------------------

def create_app(project_root: str | Path | None = None) -> FastAPI:
    global _project_root

    if project_root:
        _project_root = Path(project_root).resolve()

    @asynccontextmanager
    async def _lifespan(_: FastAPI):
        webnovel = _webnovel_dir()
        if webnovel.is_dir():
            _watcher.start(webnovel, asyncio.get_running_loop())
        try:
            yield
        finally:
            _watcher.stop()

    app = FastAPI(title="Webnovel Dashboard", version="0.1.0", lifespan=_lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    # ===========================================================
    # API：项目元信息
    # ===========================================================

    @app.get("/api/project/info")
    def project_info():
        """返回 state.json 完整内容（只读）。"""
        state_path = _webnovel_dir() / "state.json"
        if not state_path.is_file():
            raise HTTPException(404, "state.json 不存在")
        return json.loads(state_path.read_text(encoding="utf-8"))

    @app.get("/api/env-status")
    def env_status():
        """检测 RAG / Rerank 环境配置状态（仅读取本地配置与文件，不发起网络请求）。"""
        # 读取项目级 .env（best-effort，不覆盖进程已有环境变量）
        project_env: dict[str, str] = {}
        env_file = _get_project_root() / ".env"
        if env_file.is_file():
            for raw in env_file.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k:
                    project_env[k] = v

        def _get(name: str, default: str = "") -> str:
            return os.getenv(name) or project_env.get(name) or default

        embed_key = _get("EMBED_API_KEY")
        rerank_key = _get("RERANK_API_KEY")
        embed_url = _get("EMBED_BASE_URL", "https://api-inference.modelscope.cn/v1")
        rerank_url = _get("RERANK_BASE_URL", "https://api.jina.ai/v1")
        embed_model = _get("EMBED_MODEL", "Qwen/Qwen3-Embedding-8B")
        rerank_model = _get("RERANK_MODEL", "jina-reranker-v3")

        vectors_db = _webnovel_dir() / "vectors.db"
        vector_db_exists = vectors_db.is_file() and vectors_db.stat().st_size > 0

        # 推导 RAG 运行模式（对应 rag_adapter.py 三级降级逻辑）
        if not embed_key:
            rag_mode = "disabled"
        elif not vector_db_exists:
            rag_mode = "bm25_fallback"
        elif not rerank_key:
            rag_mode = "vector_only"
        else:
            rag_mode = "vector+rerank"

        return {
            "embed": {
                "key_configured": bool(embed_key),
                "base_url": embed_url,
                "model": embed_model,
            },
            "rerank": {
                "key_configured": bool(rerank_key),
                "base_url": rerank_url,
                "model": rerank_model,
            },
            "vector_db": {
                "exists": vector_db_exists,
                "size_kb": round(vectors_db.stat().st_size / 1024, 1) if vector_db_exists else 0,
            },
            "rag_mode": rag_mode,
        }

    @app.get("/api/env-status/probe")
    async def env_status_probe():
        """主动探测 Embedding / Rerank 服务连通性（发起真实 HTTP 请求，超时 8s）。"""
        import aiohttp

        # 复用 env_status 的配置读取逻辑
        project_env: dict[str, str] = {}
        env_file = _get_project_root() / ".env"
        if env_file.is_file():
            for raw in env_file.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k:
                    project_env[k] = v

        def _get(name: str, default: str = "") -> str:
            return os.getenv(name) or project_env.get(name) or default

        embed_key   = _get("EMBED_API_KEY")
        rerank_key  = _get("RERANK_API_KEY")
        embed_url   = _get("EMBED_BASE_URL", "https://api-inference.modelscope.cn/v1")
        rerank_url  = _get("RERANK_BASE_URL", "https://api.jina.ai/v1")
        embed_model = _get("EMBED_MODEL", "Qwen/Qwen3-Embedding-8B")
        rerank_model = _get("RERANK_MODEL", "jina-reranker-v3")

        TIMEOUT = aiohttp.ClientTimeout(total=8)

        async def _probe_embed() -> dict:
            if not embed_key:
                return {"ok": False, "latency_ms": None, "error": "未配置 EMBED_API_KEY"}
            url = embed_url.rstrip("/") + "/embeddings"
            headers = {"Authorization": f"Bearer {embed_key}", "Content-Type": "application/json"}
            payload = {"model": embed_model, "input": ["test"]}
            t0 = time.monotonic()
            try:
                async with aiohttp.ClientSession(timeout=TIMEOUT) as s:
                    async with s.post(url, json=payload, headers=headers) as r:
                        latency = round((time.monotonic() - t0) * 1000)
                        if r.status == 200:
                            return {"ok": True, "latency_ms": latency, "error": None}
                        text = (await r.text())[:120]
                        return {"ok": False, "latency_ms": latency, "error": f"HTTP {r.status}: {text}"}
            except asyncio.TimeoutError:
                return {"ok": False, "latency_ms": None, "error": "请求超时（>8s）"}
            except Exception as e:
                return {"ok": False, "latency_ms": None, "error": str(e)[:120]}

        async def _probe_rerank() -> dict:
            if not rerank_key:
                return {"ok": False, "latency_ms": None, "error": "未配置 RERANK_API_KEY"}
            url = rerank_url.rstrip("/") + "/rerank"
            headers = {"Authorization": f"Bearer {rerank_key}", "Content-Type": "application/json"}
            payload = {"model": rerank_model, "query": "test", "documents": ["a", "b"]}
            t0 = time.monotonic()
            try:
                async with aiohttp.ClientSession(timeout=TIMEOUT) as s:
                    async with s.post(url, json=payload, headers=headers) as r:
                        latency = round((time.monotonic() - t0) * 1000)
                        if r.status == 200:
                            return {"ok": True, "latency_ms": latency, "error": None}
                        text = (await r.text())[:120]
                        return {"ok": False, "latency_ms": latency, "error": f"HTTP {r.status}: {text}"}
            except asyncio.TimeoutError:
                return {"ok": False, "latency_ms": None, "error": "请求超时（>8s）"}
            except Exception as e:
                return {"ok": False, "latency_ms": None, "error": str(e)[:120]}

        embed_result, rerank_result = await asyncio.gather(
            _probe_embed(), _probe_rerank()
        )

        vectors_db = _webnovel_dir() / "vectors.db"
        vector_db_exists = vectors_db.is_file() and vectors_db.stat().st_size > 0

        if not embed_key:
            rag_mode = "disabled"
        elif not vector_db_exists:
            rag_mode = "bm25_fallback"
        elif not embed_result["ok"]:
            rag_mode = "bm25_fallback"
        elif not rerank_key or not rerank_result["ok"]:
            rag_mode = "vector_only"
        else:
            rag_mode = "vector+rerank"

        return {
            "embed": {
                "key_configured": bool(embed_key),
                "base_url": embed_url,
                "model": embed_model,
                **embed_result,
            },
            "rerank": {
                "key_configured": bool(rerank_key),
                "base_url": rerank_url,
                "model": rerank_model,
                **rerank_result,
            },
            "vector_db": {
                "exists": vector_db_exists,
                "size_kb": round(vectors_db.stat().st_size / 1024, 1) if vector_db_exists else 0,
            },
            "rag_mode": rag_mode,
        }

    # ===========================================================
    # API：实体数据库（index.db 只读查询）
    # ===========================================================

    def _get_db() -> sqlite3.Connection:
        db_path = _webnovel_dir() / "index.db"
        if not db_path.is_file():
            raise HTTPException(404, "index.db 不存在")
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _fetchall_safe(conn: sqlite3.Connection, query: str, params: tuple = ()) -> list[dict]:
        """执行只读查询；若目标表不存在（旧库），返回空列表。"""
        try:
            rows = conn.execute(query, params).fetchall()
            return [dict(r) for r in rows]
        except sqlite3.OperationalError as exc:
            if "no such table" in str(exc).lower():
                return []
            raise HTTPException(status_code=500, detail=f"数据库查询失败: {exc}") from exc

    @app.get("/api/entities")
    def list_entities(
        entity_type: Optional[str] = Query(None, alias="type"),
        include_archived: bool = False,
    ):
        """列出所有实体（可按类型过滤）。"""
        with closing(_get_db()) as conn:
            q = "SELECT * FROM entities"
            params: list = []
            clauses: list[str] = []
            if entity_type:
                clauses.append("type = ?")
                params.append(entity_type)
            if not include_archived:
                clauses.append("is_archived = 0")
            if clauses:
                q += " WHERE " + " AND ".join(clauses)
            q += " ORDER BY last_appearance DESC"
            rows = conn.execute(q, params).fetchall()
            return [dict(r) for r in rows]

    @app.get("/api/entities/{entity_id}")
    def get_entity(entity_id: str):
        with closing(_get_db()) as conn:
            row = conn.execute("SELECT * FROM entities WHERE id = ?", (entity_id,)).fetchone()
            if not row:
                raise HTTPException(404, "实体不存在")
            return dict(row)

    @app.get("/api/relationships")
    def list_relationships(entity: Optional[str] = None, limit: int = 200):
        with closing(_get_db()) as conn:
            if entity:
                rows = conn.execute(
                    "SELECT * FROM relationships WHERE from_entity = ? OR to_entity = ? ORDER BY chapter DESC LIMIT ?",
                    (entity, entity, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM relationships ORDER BY chapter DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            return [dict(r) for r in rows]

    @app.get("/api/relationship-events")
    def list_relationship_events(
        entity: Optional[str] = None,
        from_chapter: Optional[int] = None,
        to_chapter: Optional[int] = None,
        limit: int = 200,
    ):
        with closing(_get_db()) as conn:
            q = "SELECT * FROM relationship_events"
            params: list = []
            clauses: list[str] = []
            if entity:
                clauses.append("(from_entity = ? OR to_entity = ?)")
                params.extend([entity, entity])
            if from_chapter is not None:
                clauses.append("chapter >= ?")
                params.append(from_chapter)
            if to_chapter is not None:
                clauses.append("chapter <= ?")
                params.append(to_chapter)
            if clauses:
                q += " WHERE " + " AND ".join(clauses)
            q += " ORDER BY chapter DESC, id DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(q, params).fetchall()
            return [dict(r) for r in rows]

    @app.get("/api/chapters")
    def list_chapters():
        with closing(_get_db()) as conn:
            rows = conn.execute("SELECT * FROM chapters ORDER BY chapter ASC").fetchall()
            return [dict(r) for r in rows]

    @app.get("/api/scenes")
    def list_scenes(chapter: Optional[int] = None, limit: int = 500):
        with closing(_get_db()) as conn:
            if chapter is not None:
                rows = conn.execute(
                    "SELECT * FROM scenes WHERE chapter = ? ORDER BY scene_index ASC", (chapter,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM scenes ORDER BY chapter ASC, scene_index ASC LIMIT ?", (limit,)
                ).fetchall()
            return [dict(r) for r in rows]

    @app.get("/api/reading-power")
    def list_reading_power(limit: int = 50):
        with closing(_get_db()) as conn:
            rows = conn.execute(
                "SELECT * FROM chapter_reading_power ORDER BY chapter DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(r) for r in rows]

    @app.get("/api/review-metrics")
    def list_review_metrics(limit: int = 20):
        with closing(_get_db()) as conn:
            rows = conn.execute(
                "SELECT * FROM review_metrics ORDER BY end_chapter DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(r) for r in rows]

    @app.get("/api/state-changes")
    def list_state_changes(entity: Optional[str] = None, limit: int = 100):
        with closing(_get_db()) as conn:
            if entity:
                rows = conn.execute(
                    "SELECT * FROM state_changes WHERE entity_id = ? ORDER BY chapter DESC LIMIT ?",
                    (entity, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM state_changes ORDER BY chapter DESC LIMIT ?", (limit,)
                ).fetchall()
            return [dict(r) for r in rows]

    @app.get("/api/aliases")
    def list_aliases(entity: Optional[str] = None):
        with closing(_get_db()) as conn:
            if entity:
                rows = conn.execute(
                    "SELECT * FROM aliases WHERE entity_id = ?", (entity,)
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM aliases").fetchall()
            return [dict(r) for r in rows]

    # ===========================================================
    # API：扩展表（v5.3+ / v5.4+）
    # ===========================================================

    @app.get("/api/overrides")
    def list_overrides(status: Optional[str] = None, limit: int = 100):
        with closing(_get_db()) as conn:
            if status:
                return _fetchall_safe(
                    conn,
                    "SELECT * FROM override_contracts WHERE status = ? ORDER BY chapter DESC LIMIT ?",
                    (status, limit),
                )
            return _fetchall_safe(
                conn,
                "SELECT * FROM override_contracts ORDER BY chapter DESC LIMIT ?",
                (limit,),
            )

    @app.get("/api/debts")
    def list_debts(status: Optional[str] = None, limit: int = 100):
        with closing(_get_db()) as conn:
            if status:
                return _fetchall_safe(
                    conn,
                    "SELECT * FROM chase_debt WHERE status = ? ORDER BY updated_at DESC LIMIT ?",
                    (status, limit),
                )
            return _fetchall_safe(
                conn,
                "SELECT * FROM chase_debt ORDER BY updated_at DESC LIMIT ?",
                (limit,),
            )

    @app.get("/api/debt-events")
    def list_debt_events(debt_id: Optional[int] = None, limit: int = 200):
        with closing(_get_db()) as conn:
            if debt_id is not None:
                return _fetchall_safe(
                    conn,
                    "SELECT * FROM debt_events WHERE debt_id = ? ORDER BY chapter DESC, id DESC LIMIT ?",
                    (debt_id, limit),
                )
            return _fetchall_safe(
                conn,
                "SELECT * FROM debt_events ORDER BY chapter DESC, id DESC LIMIT ?",
                (limit,),
            )

    @app.get("/api/invalid-facts")
    def list_invalid_facts(status: Optional[str] = None, limit: int = 100):
        with closing(_get_db()) as conn:
            if status:
                return _fetchall_safe(
                    conn,
                    "SELECT * FROM invalid_facts WHERE status = ? ORDER BY marked_at DESC LIMIT ?",
                    (status, limit),
                )
            return _fetchall_safe(
                conn,
                "SELECT * FROM invalid_facts ORDER BY marked_at DESC LIMIT ?",
                (limit,),
            )

    @app.get("/api/rag-queries")
    def list_rag_queries(query_type: Optional[str] = None, limit: int = 100):
        with closing(_get_db()) as conn:
            if query_type:
                return _fetchall_safe(
                    conn,
                    "SELECT * FROM rag_query_log WHERE query_type = ? ORDER BY created_at DESC LIMIT ?",
                    (query_type, limit),
                )
            return _fetchall_safe(
                conn,
                "SELECT * FROM rag_query_log ORDER BY created_at DESC LIMIT ?",
                (limit,),
            )

    @app.get("/api/tool-stats")
    def list_tool_stats(tool_name: Optional[str] = None, limit: int = 200):
        with closing(_get_db()) as conn:
            if tool_name:
                return _fetchall_safe(
                    conn,
                    "SELECT * FROM tool_call_stats WHERE tool_name = ? ORDER BY created_at DESC LIMIT ?",
                    (tool_name, limit),
                )
            return _fetchall_safe(
                conn,
                "SELECT * FROM tool_call_stats ORDER BY created_at DESC LIMIT ?",
                (limit,),
            )

    @app.get("/api/checklist-scores")
    def list_checklist_scores(limit: int = 100):
        with closing(_get_db()) as conn:
            return _fetchall_safe(
                conn,
                "SELECT * FROM writing_checklist_scores ORDER BY chapter DESC LIMIT ?",
                (limit,),
            )

    # ===========================================================
    # API：文档浏览（正文/大纲/设定集 —— 只读）
    # ===========================================================

    @app.get("/api/files/tree")
    def file_tree():
        """列出 正文/、大纲/、设定集/ 三个目录的树结构。"""
        root = _get_project_root()
        result = {}
        for folder_name in ("正文", "大纲", "设定集"):
            folder = root / folder_name
            if not folder.is_dir():
                result[folder_name] = []
                continue
            result[folder_name] = _walk_tree(folder, root)
        return result

    @app.get("/api/files/read")
    def file_read(path: str):
        """只读读取一个文件内容（限 正文/大纲/设定集 目录）。"""
        root = _get_project_root()
        resolved = safe_resolve(root, path)

        # 二次限制：只允许三大目录
        allowed_parents = [root / n for n in ("正文", "大纲", "设定集")]
        if not any(_is_child(resolved, p) for p in allowed_parents):
            raise HTTPException(403, "仅允许读取 正文/大纲/设定集 目录下的文件")

        if not resolved.is_file():
            raise HTTPException(404, "文件不存在")

        # 文本文件直接读；其他情况返回占位信息
        try:
            content = resolved.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            content = "[二进制文件，无法预览]"

        return {"path": path, "content": content}

    # ===========================================================
    # SSE：实时变更推送
    # ===========================================================

    @app.get("/api/events")
    async def sse():
        """Server-Sent Events 端点，推送 .webnovel/ 下的文件变更。"""
        q = _watcher.subscribe()

        async def _gen():
            try:
                while True:
                    msg = await q.get()
                    yield f"data: {msg}\n\n"
            except asyncio.CancelledError:
                pass
            finally:
                _watcher.unsubscribe(q)

        return StreamingResponse(_gen(), media_type="text/event-stream")

    # ===========================================================
    # 前端静态文件托管
    # ===========================================================

    if STATIC_DIR.is_dir():
        app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

        @app.get("/{full_path:path}")
        def serve_spa(full_path: str):
            """SPA fallback：任何非 /api 路径都返回 index.html。"""
            index = STATIC_DIR / "index.html"
            if index.is_file():
                return FileResponse(str(index))
            raise HTTPException(404, "前端尚未构建")
    else:
        @app.get("/")
        def no_frontend():
            return HTMLResponse(
                "<h2>Webnovel Dashboard API is running</h2>"
                "<p>前端尚未构建。请先在 <code>dashboard/frontend</code> 目录执行 <code>npm run build</code>。</p>"
                '<p>API 文档：<a href="/docs">/docs</a></p>'
            )

    return app


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

def _walk_tree(folder: Path, root: Path) -> list[dict]:
    items = []
    for child in sorted(folder.iterdir()):
        rel = str(child.relative_to(root)).replace("\\", "/")
        if child.is_dir():
            items.append({"name": child.name, "type": "dir", "path": rel, "children": _walk_tree(child, root)})
        else:
            items.append({"name": child.name, "type": "file", "path": rel, "size": child.stat().st_size})
    return items


def _is_child(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False
