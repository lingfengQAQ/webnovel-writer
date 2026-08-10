from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def default_data_dir() -> Path:
    override = os.environ.get("WEBNOVEL_WRITER_DATA_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    if sys.platform == "win32":
        root = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or Path.home())
    elif sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support"
    else:
        root = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
    return root / "webnovel-writer"


class WriterStore:
    def __init__(self, db_path: str | Path | None = None):
        self.db_path = Path(db_path) if db_path else default_data_dir() / "writer.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with closing(self._connect()) as conn:
            conn.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS workflows (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    project_root TEXT NOT NULL,
                    status TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    progress INTEGER NOT NULL,
                    request_json TEXT NOT NULL,
                    result_json TEXT NOT NULL,
                    error TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS drafts (
                    project_root TEXT NOT NULL,
                    chapter INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,
                    reviewed_sha256 TEXT NOT NULL DEFAULT '',
                    review_json TEXT NOT NULL DEFAULT '{}',
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(project_root, chapter)
                );
                CREATE TABLE IF NOT EXISTS prompt_prefixes (
                    prefix_id TEXT PRIMARY KEY,
                    model TEXT NOT NULL,
                    common_json TEXT NOT NULL,
                    acknowledgement TEXT NOT NULL,
                    warmed_at TEXT NOT NULL,
                    last_used_at TEXT NOT NULL,
                    low_hit_streak INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS llm_usage (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    workflow_id TEXT NOT NULL,
                    project_root TEXT NOT NULL,
                    task TEXT NOT NULL,
                    model TEXT NOT NULL,
                    prefix_id TEXT NOT NULL,
                    hit_tokens INTEGER NOT NULL,
                    miss_tokens INTEGER NOT NULL,
                    completion_tokens INTEGER NOT NULL,
                    latency_ms INTEGER NOT NULL,
                    estimated_cost_usd REAL NOT NULL,
                    is_warmup INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )
            conn.commit()

    def get_settings(self) -> dict[str, Any]:
        with closing(self._connect()) as conn:
            rows = conn.execute("SELECT key, value FROM settings").fetchall()
        result: dict[str, Any] = {}
        for row in rows:
            try:
                result[row["key"]] = json.loads(row["value"])
            except json.JSONDecodeError:
                result[row["key"]] = row["value"]
        return result

    def save_settings(self, payload: dict[str, Any]) -> None:
        with closing(self._connect()) as conn:
            for key, value in payload.items():
                conn.execute(
                    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (key, json.dumps(value, ensure_ascii=False)),
                )
            conn.commit()

    def create_workflow(self, payload: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        record = {
            "id": payload["id"], "type": payload["type"], "project_root": payload["project_root"],
            "status": "queued", "stage": "queued", "progress": 0,
            "request": payload.get("request") or {}, "result": {}, "error": "",
            "created_at": now, "updated_at": now,
        }
        with closing(self._connect()) as conn:
            conn.execute(
                "INSERT INTO workflows VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (record["id"], record["type"], record["project_root"], record["status"], record["stage"],
                 record["progress"], json.dumps(record["request"], ensure_ascii=False), "{}", "", now, now),
            )
            conn.commit()
        return record

    def update_workflow(self, workflow_id: str, **changes: Any) -> dict[str, Any]:
        allowed = {"status", "stage", "progress", "result", "error"}
        assignments: list[str] = []
        params: list[Any] = []
        for key, value in changes.items():
            if key not in allowed:
                continue
            column = "result_json" if key == "result" else key
            assignments.append(f"{column}=?")
            params.append(json.dumps(value, ensure_ascii=False) if key == "result" else value)
        assignments.append("updated_at=?")
        params.append(utc_now())
        params.append(workflow_id)
        with closing(self._connect()) as conn:
            conn.execute(f"UPDATE workflows SET {', '.join(assignments)} WHERE id=?", params)
            conn.commit()
        record = self.get_workflow(workflow_id)
        if record is None:
            raise KeyError(workflow_id)
        return record

    def get_workflow(self, workflow_id: str) -> dict[str, Any] | None:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT * FROM workflows WHERE id=?", (workflow_id,)).fetchone()
        return self._workflow_row(row) if row else None

    def list_workflows(self, project_root: str, limit: int = 30) -> list[dict[str, Any]]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT * FROM workflows WHERE project_root=? ORDER BY created_at DESC LIMIT ?",
                (project_root, max(1, min(limit, 100))),
            ).fetchall()
        return [self._workflow_row(row) for row in rows]

    @staticmethod
    def _workflow_row(row: sqlite3.Row) -> dict[str, Any]:
        data = dict(row)
        data["request"] = json.loads(data.pop("request_json") or "{}")
        data["result"] = json.loads(data.pop("result_json") or "{}")
        return data

    def get_draft(self, project_root: str, chapter: int) -> dict[str, Any] | None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT * FROM drafts WHERE project_root=? AND chapter=?", (project_root, chapter)
            ).fetchone()
        if not row:
            return None
        data = dict(row)
        data["review"] = json.loads(data.pop("review_json") or "{}")
        return data

    def save_draft(self, project_root: str, chapter: int, content: str, base_revision: int | None = None) -> dict[str, Any]:
        existing = self.get_draft(project_root, chapter)
        current_revision = int(existing["revision"]) if existing else 0
        if base_revision is not None and base_revision != current_revision:
            raise ValueError(f"draft revision conflict: expected {base_revision}, current {current_revision}")
        revision = current_revision + 1
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        now = utc_now()
        reviewed_sha = existing.get("reviewed_sha256", "") if existing and existing.get("sha256") == digest else ""
        review = existing.get("review", {}) if reviewed_sha else {}
        with closing(self._connect()) as conn:
            conn.execute(
                """INSERT INTO drafts VALUES(?,?,?,?,?,?,?,?)
                ON CONFLICT(project_root,chapter) DO UPDATE SET
                content=excluded.content, revision=excluded.revision, sha256=excluded.sha256,
                reviewed_sha256=excluded.reviewed_sha256, review_json=excluded.review_json, updated_at=excluded.updated_at""",
                (project_root, chapter, content, revision, digest, reviewed_sha,
                 json.dumps(review, ensure_ascii=False), now),
            )
            conn.commit()
        return self.get_draft(project_root, chapter) or {}

    def mark_reviewed(self, project_root: str, chapter: int, review: dict[str, Any]) -> dict[str, Any]:
        draft = self.get_draft(project_root, chapter)
        if not draft:
            raise KeyError("draft not found")
        with closing(self._connect()) as conn:
            conn.execute(
                "UPDATE drafts SET reviewed_sha256=sha256, review_json=?, updated_at=? WHERE project_root=? AND chapter=?",
                (json.dumps(review, ensure_ascii=False), utc_now(), project_root, chapter),
            )
            conn.commit()
        return self.get_draft(project_root, chapter) or {}

    def get_prefix(self, prefix_id: str) -> dict[str, Any] | None:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT * FROM prompt_prefixes WHERE prefix_id=?", (prefix_id,)).fetchone()
        if not row:
            return None
        data = dict(row)
        data["common"] = json.loads(data.pop("common_json"))
        return data

    def save_prefix(self, prefix_id: str, model: str, common: dict[str, Any], acknowledgement: str) -> None:
        now = utc_now()
        with closing(self._connect()) as conn:
            conn.execute(
                """INSERT INTO prompt_prefixes VALUES(?,?,?,?,?,?,0)
                ON CONFLICT(prefix_id) DO UPDATE SET acknowledgement=excluded.acknowledgement,
                warmed_at=excluded.warmed_at,last_used_at=excluded.last_used_at,low_hit_streak=0""",
                (prefix_id, model, json.dumps(common, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                 acknowledgement, now, now),
            )
            conn.commit()

    def touch_prefix(self, prefix_id: str, hit_rate: float) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                "UPDATE prompt_prefixes SET last_used_at=?, low_hit_streak=CASE WHEN ? < 0.4 THEN low_hit_streak+1 ELSE 0 END WHERE prefix_id=?",
                (utc_now(), hit_rate, prefix_id),
            )
            conn.commit()

    def record_usage(self, usage: dict[str, Any]) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                """INSERT INTO llm_usage(workflow_id,project_root,task,model,prefix_id,hit_tokens,miss_tokens,
                completion_tokens,latency_ms,estimated_cost_usd,is_warmup,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (usage.get("workflow_id", ""), usage["project_root"], usage["task"], usage["model"], usage["prefix_id"],
                 usage.get("prompt_cache_hit_tokens", 0), usage.get("prompt_cache_miss_tokens", 0),
                 usage.get("completion_tokens", 0), usage.get("latency_ms", 0), usage.get("estimated_cost_usd", 0.0),
                 int(bool(usage.get("is_warmup"))), usage.get("created_at") or utc_now()),
            )
            conn.commit()

    def usage_summary(self, project_root: str, limit: int = 20) -> dict[str, Any]:
        with closing(self._connect()) as conn:
            rows = conn.execute(
                "SELECT * FROM llm_usage WHERE project_root=? ORDER BY id DESC LIMIT ?",
                (project_root, max(1, min(limit, 200))),
            ).fetchall()
            totals = conn.execute(
                "SELECT COALESCE(SUM(hit_tokens),0),COALESCE(SUM(miss_tokens),0),COALESCE(SUM(completion_tokens),0),COALESCE(SUM(estimated_cost_usd),0) FROM llm_usage WHERE project_root=?",
                (project_root,),
            ).fetchone()
        items = [dict(row) for row in rows]
        rates = [row["hit_tokens"] / (row["hit_tokens"] + row["miss_tokens"])
                 for row in items if not row["is_warmup"] and row["hit_tokens"] + row["miss_tokens"] > 0]
        rates.sort()
        median = rates[len(rates) // 2] if rates else 0.0
        total_input = int(totals[0]) + int(totals[1])
        return {
            "recent": items,
            "recent_median_hit_rate": median,
            "total_hit_tokens": int(totals[0]), "total_miss_tokens": int(totals[1]),
            "total_completion_tokens": int(totals[2]), "estimated_cost_usd": float(totals[3]),
            "total_hit_rate": (int(totals[0]) / total_input) if total_input else 0.0,
            "target_hit_rate": 0.60,
        }
