from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from dashboard.routers.edit_assist import router as edit_assist_router
from dashboard.services.edit_assist import service as edit_assist_service_module


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(edit_assist_router)
    return app


def _setup_project(test_name: str) -> tuple[Path, Path]:
    base = PROJECT_ROOT / ".tmp" / "t07-tests"
    base.mkdir(parents=True, exist_ok=True)
    project_root = base / f"{test_name}-{uuid4().hex[:8]}"
    chapter_dir = project_root / "正文"
    chapter_dir.mkdir(parents=True, exist_ok=True)
    chapter_path = chapter_dir / "第一章.md"
    chapter_path.write_text("晨雾笼罩城门，守卫正在换岗。", encoding="utf-8")
    return project_root, chapter_path


def _workspace_payload(project_root: Path) -> dict:
    return {"workspace_id": "workspace-default", "project_root": str(project_root)}


def _selection_version(file_path: str, selection_start: int, selection_end: int, text: str) -> str:
    payload = json.dumps(
        {
            "file_path": file_path.replace("\\", "/"),
            "selection_start": selection_start,
            "selection_end": selection_end,
            "text": text,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _selection_range(content: str, selection: str) -> tuple[int, int]:
    start = content.index(selection)
    return start, start + len(selection)


def test_edit_assist_preview_apply_and_logs_success():
    project_root, chapter_path = _setup_project("assist-success")
    try:
        original_content = chapter_path.read_text(encoding="utf-8")
        selection = "守卫正在换岗"
        selection_start, selection_end = _selection_range(original_content, selection)
        relative_path = "正文/第一章.md"

        app = _build_app()
        with TestClient(app) as client:
            preview_response = client.post(
                "/api/edit-assist/preview",
                json={
                    "workspace": _workspace_payload(project_root),
                    "file_path": relative_path,
                    "selection_start": selection_start,
                    "selection_end": selection_end,
                    "selection_text": selection,
                    "prompt": "改成更有压迫感",
                },
            )
            assert preview_response.status_code == 200
            preview_payload = preview_response.json()
            assert preview_payload["status"] == "ok"
            proposal = preview_payload["proposal"]
            assert proposal["before_text"] == selection

            expected_version = _selection_version(
                relative_path,
                selection_start,
                selection_end,
                proposal["before_text"],
            )

            apply_response = client.post(
                "/api/edit-assist/apply",
                json={
                    "workspace": _workspace_payload(project_root),
                    "proposal_id": proposal["id"],
                    "file_path": relative_path,
                    "selection_start": selection_start,
                    "selection_end": selection_end,
                    "expected_version": expected_version,
                },
            )
            assert apply_response.status_code == 200
            apply_payload = apply_response.json()
            assert apply_payload["status"] == "ok"
            assert apply_payload["log_entry"]["applied"] is True

            updated_content = chapter_path.read_text(encoding="utf-8")
            assert "[EditAssist] 改成更有压迫感" in updated_content

            logs_response = client.get(
                "/api/edit-assist/logs",
                params={
                    "workspace_id": "workspace-default",
                    "project_root": str(project_root),
                    "limit": 20,
                    "offset": 0,
                },
            )
            assert logs_response.status_code == 200
            logs_payload = logs_response.json()
            assert logs_payload["status"] == "ok"
            assert logs_payload["total"] == 1
            assert logs_payload["items"][0]["applied"] is True

            log_path = project_root / ".webnovel" / "edits" / "assist-log.jsonl"
            assert log_path.is_file()
            raw_entries = [
                json.loads(line)
                for line in log_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            assert len(raw_entries) == 1
            assert {"id", "file_path", "selection_start", "selection_end", "prompt", "preview", "applied", "created_at"}.issubset(
                raw_entries[0].keys()
            )
            assert raw_entries[0]["applied"] is True
    finally:
        shutil.rmtree(project_root, ignore_errors=True)


def test_edit_assist_apply_rejects_selection_version_conflict_and_logs_failure():
    project_root, chapter_path = _setup_project("assist-version-conflict")
    try:
        original_content = chapter_path.read_text(encoding="utf-8")
        selection = "守卫正在换岗"
        selection_start, selection_end = _selection_range(original_content, selection)
        relative_path = "正文/第一章.md"

        app = _build_app()
        with TestClient(app) as client:
            preview_response = client.post(
                "/api/edit-assist/preview",
                json={
                    "workspace": _workspace_payload(project_root),
                    "file_path": relative_path,
                    "selection_start": selection_start,
                    "selection_end": selection_end,
                    "selection_text": selection,
                    "prompt": "保持语义不变，略作润色",
                },
            )
            assert preview_response.status_code == 200
            proposal = preview_response.json()["proposal"]
            expected_version = _selection_version(
                relative_path,
                selection_start,
                selection_end,
                proposal["before_text"],
            )

            chapter_path.write_text(original_content.replace(selection, "守卫已经离岗"), encoding="utf-8")

            apply_response = client.post(
                "/api/edit-assist/apply",
                json={
                    "workspace": _workspace_payload(project_root),
                    "proposal_id": proposal["id"],
                    "file_path": relative_path,
                    "selection_start": selection_start,
                    "selection_end": selection_end,
                    "expected_version": expected_version,
                },
            )
            assert apply_response.status_code == 409
            assert apply_response.json()["error_code"] == "EDIT_ASSIST_SELECTION_VERSION_CONFLICT"

            preserved = chapter_path.read_text(encoding="utf-8")
            assert "守卫已经离岗" in preserved
            assert "[EditAssist]" not in preserved

            logs_response = client.get(
                "/api/edit-assist/logs",
                params={
                    "workspace_id": "workspace-default",
                    "project_root": str(project_root),
                    "applied": False,
                    "limit": 20,
                    "offset": 0,
                },
            )
            assert logs_response.status_code == 200
            logs_payload = logs_response.json()
            assert logs_payload["total"] == 1
            assert logs_payload["items"][0]["applied"] is False

            log_path = project_root / ".webnovel" / "edits" / "assist-log.jsonl"
            raw_entry = json.loads(log_path.read_text(encoding="utf-8").splitlines()[0])
            assert raw_entry["error_code"] == "EDIT_ASSIST_SELECTION_VERSION_CONFLICT"
            assert raw_entry["rollback_performed"] is False
    finally:
        shutil.rmtree(project_root, ignore_errors=True)


def test_edit_assist_apply_write_failure_rolls_back_and_logs_failure(monkeypatch):
    project_root, chapter_path = _setup_project("assist-write-rollback")
    try:
        original_content = chapter_path.read_text(encoding="utf-8")
        selection = "守卫正在换岗"
        selection_start, selection_end = _selection_range(original_content, selection)
        relative_path = "正文/第一章.md"

        app = _build_app()
        with TestClient(app) as client:
            preview_response = client.post(
                "/api/edit-assist/preview",
                json={
                    "workspace": _workspace_payload(project_root),
                    "file_path": relative_path,
                    "selection_start": selection_start,
                    "selection_end": selection_end,
                    "selection_text": selection,
                    "prompt": "替换为更紧张的语气",
                },
            )
            assert preview_response.status_code == 200
            proposal = preview_response.json()["proposal"]
            expected_version = _selection_version(
                relative_path,
                selection_start,
                selection_end,
                proposal["before_text"],
            )

            original_atomic_write = edit_assist_service_module._atomic_write_text
            call_count = {"value": 0}

            def flaky_atomic_write(path: Path, content: str) -> None:
                call_count["value"] += 1
                if call_count["value"] == 1:
                    path.write_text("写入失败后的脏内容", encoding="utf-8")
                    raise OSError("simulated write failure")
                original_atomic_write(path, content)

            monkeypatch.setattr(edit_assist_service_module, "_atomic_write_text", flaky_atomic_write)

            apply_response = client.post(
                "/api/edit-assist/apply",
                json={
                    "workspace": _workspace_payload(project_root),
                    "proposal_id": proposal["id"],
                    "file_path": relative_path,
                    "selection_start": selection_start,
                    "selection_end": selection_end,
                    "expected_version": expected_version,
                },
            )
            assert apply_response.status_code == 500
            assert apply_response.json()["error_code"] == "EDIT_ASSIST_APPLY_WRITE_FAILED"

            restored_content = chapter_path.read_text(encoding="utf-8")
            assert restored_content == original_content

            log_path = project_root / ".webnovel" / "edits" / "assist-log.jsonl"
            raw_entry = json.loads(log_path.read_text(encoding="utf-8").splitlines()[0])
            assert raw_entry["applied"] is False
            assert raw_entry["error_code"] == "EDIT_ASSIST_APPLY_WRITE_FAILED"
            assert raw_entry["rollback_performed"] is True
    finally:
        shutil.rmtree(project_root, ignore_errors=True)
