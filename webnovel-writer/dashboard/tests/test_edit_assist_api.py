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

from dashboard.routers import edit_assist as edit_assist_router_module
from dashboard.routers.edit_assist import router as edit_assist_router
from dashboard.services.edit_assist import service as edit_assist_service_module


class DeterministicProvider:
    provider_name = "test-provider"
    model_name = "test-model-v1"

    def ensure_available(self) -> None:
        return None

    def rewrite(
        self,
        *,
        project_root: Path,
        file_path: str,
        selection_start: int,
        selection_end: int,
        selection_text: str,
        prompt: str,
    ) -> edit_assist_service_module.EditAssistProviderResult:
        rewritten = f"【改写:{prompt or 'default'}】{selection_text}（provider）"
        return edit_assist_service_module.EditAssistProviderResult(
            output_text=rewritten,
            provider=self.provider_name,
            model=self.model_name,
        )


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(edit_assist_router)
    return app


def _install_provider(monkeypatch, provider) -> None:
    service = edit_assist_service_module.EditAssistService(provider=provider)
    monkeypatch.setattr(edit_assist_router_module, "edit_assist_service", service)


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


def _proposal_ref_payload(proposal: dict) -> dict:
    return {
        "id": proposal["id"],
        "version": proposal["version"],
        "selection_version": proposal["selection_version"],
        "source": proposal["source"],
    }


def test_edit_assist_preview_apply_and_logs_success(monkeypatch):
    _install_provider(monkeypatch, DeterministicProvider())
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
            proposal = preview_payload["proposal"]
            assert proposal["before_text"] == selection
            assert proposal["source"]["provider"] == "test-provider"
            assert proposal["source"]["model"] == "test-model-v1"
            assert isinstance(proposal["provider_latency_ms"], int)
            assert proposal["provider_latency_ms"] >= 0
            assert "[EditAssist]" not in proposal["preview"]

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
                    "proposal": _proposal_ref_payload(proposal),
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
            assert apply_payload["log_entry"]["provider"] == "test-provider"
            assert apply_payload["log_entry"]["model"] == "test-model-v1"
            assert apply_payload["log_entry"]["rollback_performed"] is False
            assert isinstance(apply_payload["log_entry"]["apply_latency_ms"], int)
            assert isinstance(apply_payload["log_entry"]["provider_latency_ms"], int)

            updated_content = chapter_path.read_text(encoding="utf-8")
            assert "【改写:改成更有压迫感】守卫正在换岗（provider）" in updated_content

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
            assert logs_payload["items"][0]["provider"] == "test-provider"
            assert logs_payload["items"][0]["model"] == "test-model-v1"

            log_path = project_root / ".webnovel" / "edits" / "assist-log.jsonl"
            assert log_path.is_file()
            raw_entries = [
                json.loads(line)
                for line in log_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            assert len(raw_entries) == 1
            assert raw_entries[0]["applied"] is True
            assert raw_entries[0]["provider"] == "test-provider"
            assert raw_entries[0]["model"] == "test-model-v1"
            assert isinstance(raw_entries[0]["provider_latency_ms"], int)
            assert isinstance(raw_entries[0]["apply_latency_ms"], int)
            assert raw_entries[0]["rollback_performed"] is False
    finally:
        shutil.rmtree(project_root, ignore_errors=True)


def test_edit_assist_apply_rejects_selection_version_conflict_and_logs_failure(monkeypatch):
    _install_provider(monkeypatch, DeterministicProvider())
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
                    "proposal": _proposal_ref_payload(proposal),
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
            assert "（provider）" not in preserved

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
            assert logs_payload["items"][0]["provider"] == "test-provider"
            assert logs_payload["items"][0]["model"] == "test-model-v1"

            log_path = project_root / ".webnovel" / "edits" / "assist-log.jsonl"
            raw_entry = json.loads(log_path.read_text(encoding="utf-8").splitlines()[0])
            assert raw_entry["error_code"] == "EDIT_ASSIST_SELECTION_VERSION_CONFLICT"
            assert raw_entry["rollback_performed"] is False
            assert raw_entry["provider"] == "test-provider"
            assert raw_entry["model"] == "test-model-v1"
            assert isinstance(raw_entry["apply_latency_ms"], int)
    finally:
        shutil.rmtree(project_root, ignore_errors=True)


def test_edit_assist_unavailable_returns_501_and_does_not_write(monkeypatch):
    _install_provider(monkeypatch, edit_assist_service_module.UnavailableEditAssistProvider())
    project_root, chapter_path = _setup_project("assist-unavailable")
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
                    "prompt": "改写",
                },
            )
            assert preview_response.status_code == 501
            assert preview_response.json()["error_code"] == "EDIT_ASSIST_UNAVAILABLE"

            apply_response = client.post(
                "/api/edit-assist/apply",
                json={
                    "workspace": _workspace_payload(project_root),
                    "proposal": {
                        "id": "proposal-fake",
                        "version": 1,
                        "selection_version": "fake-version",
                        "source": {"provider": "fake-provider", "model": "fake-model"},
                    },
                    "file_path": relative_path,
                    "selection_start": selection_start,
                    "selection_end": selection_end,
                    "expected_version": "fake-version",
                },
            )
            assert apply_response.status_code == 501
            assert apply_response.json()["error_code"] == "EDIT_ASSIST_UNAVAILABLE"

            assert chapter_path.read_text(encoding="utf-8") == original_content
            assert not (project_root / ".webnovel" / "edits" / "assist-log.jsonl").exists()
    finally:
        shutil.rmtree(project_root, ignore_errors=True)


def test_edit_assist_apply_write_failure_rolls_back_and_logs_failure(monkeypatch):
    _install_provider(monkeypatch, DeterministicProvider())
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
                    "proposal": _proposal_ref_payload(proposal),
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
            assert raw_entry["provider"] == "test-provider"
            assert raw_entry["model"] == "test-model-v1"
            assert isinstance(raw_entry["provider_latency_ms"], int)
            assert isinstance(raw_entry["apply_latency_ms"], int)
    finally:
        shutil.rmtree(project_root, ignore_errors=True)
