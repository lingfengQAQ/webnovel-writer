from __future__ import annotations

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

from dashboard.routers.settings import dictionary_router, files_router


def _make_workspace_payload(project_root: Path) -> dict:
    return {
        "workspace_id": "workspace-default",
        "project_root": str(project_root),
    }


def _setup_project(test_name: str) -> Path:
    base = PROJECT_ROOT / ".tmp" / "t05-tests"
    base.mkdir(parents=True, exist_ok=True)
    project_root = base / f"{test_name}-{uuid4().hex[:8]}"
    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / "设定集" / "世界").mkdir(parents=True, exist_ok=True)
    (project_root / "设定集" / "人物").mkdir(parents=True, exist_ok=True)
    return project_root


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(files_router)
    app.include_router(dictionary_router)
    return app


def test_settings_files_tree_and_read():
    project_root = _setup_project("settings-files")
    settings_file = project_root / "设定集" / "世界" / "地理.md"
    settings_file.write_text("火焰城(地点): region=北境; ruler=炎王\n", encoding="utf-8")

    app = _build_app()
    try:
        with TestClient(app) as client:
            tree_response = client.get(
                "/api/settings/files/tree",
                params={
                    "workspace_id": "workspace-default",
                    "project_root": str(project_root),
                },
            )
            assert tree_response.status_code == 200
            tree_data = tree_response.json()
            assert tree_data["status"] == "ok"
            assert tree_data["nodes"][0]["path"] == "设定集"

            read_response = client.get(
                "/api/settings/files/read",
                params={
                    "workspace_id": "workspace-default",
                    "project_root": str(project_root),
                    "path": "设定集/世界/地理.md",
                },
            )
            assert read_response.status_code == 200
            assert "火焰城" in read_response.json()["content"]
    finally:
        shutil.rmtree(project_root, ignore_errors=True)


def test_dictionary_extract_incremental_and_conflict_resolution():
    project_root = _setup_project("settings-dictionary")
    try:
        (project_root / "设定集" / "世界" / "地理.md").write_text(
            "\n".join(
                [
                    "火焰城(地点): region=北境; ruler=炎王",
                    "炎王(角色): title=王; power=火",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        (project_root / "设定集" / "人物" / "冲突.md").write_text(
            "火焰城(地点): region=南境; ruler=炎王\n",
            encoding="utf-8",
        )

        app = _build_app()
        workspace = _make_workspace_payload(project_root)
        with TestClient(app) as client:
            extract_response = client.post(
                "/api/settings/dictionary/extract",
                json={"workspace": workspace, "incremental": True},
            )
            assert extract_response.status_code == 200
            extract_data = extract_response.json()
            assert extract_data["status"] == "ok"
            assert extract_data["extracted"] == 3
            assert extract_data["conflicts"] >= 1

            dictionary_path = project_root / ".webnovel" / "dictionaries" / "setting-dictionary.json"
            assert dictionary_path.is_file()
            dictionary_payload = json.loads(dictionary_path.read_text(encoding="utf-8"))
            assert dictionary_payload["entries"]
            assert all(
                {"source_file", "source_span", "fingerprint"}.issubset(item.keys())
                for item in dictionary_payload["entries"]
            )
            assert all("-" in item["source_span"] for item in dictionary_payload["entries"])

            incremental_response = client.post(
                "/api/settings/dictionary/extract",
                json={"workspace": workspace, "incremental": True},
            )
            assert incremental_response.status_code == 200
            assert incremental_response.json()["extracted"] == 0

            conflicts = dictionary_payload["conflicts"]
            assert conflicts
            conflict_id = conflicts[0]["id"]

            resolve_response = client.post(
                f"/api/settings/dictionary/conflicts/{conflict_id}/resolve",
                json={
                    "workspace": workspace,
                    "decision": "confirm",
                    "attrs": {"region": "北境", "ruler": "炎王"},
                },
            )
            assert resolve_response.status_code == 200
            assert resolve_response.json()["conflict"]["status"] == "resolved"

            confirmed_response = client.get(
                "/api/settings/dictionary",
                params={
                    "workspace_id": "workspace-default",
                    "project_root": str(project_root),
                    "status": "confirmed",
                },
            )
            assert confirmed_response.status_code == 200
            confirmed_items = confirmed_response.json()["items"]
            assert any(item["term"] == "火焰城" and item["status"] == "confirmed" for item in confirmed_items)
    finally:
        shutil.rmtree(project_root, ignore_errors=True)
