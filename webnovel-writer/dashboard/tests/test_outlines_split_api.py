from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from dashboard.routers.outlines import router as outlines_router


def _bootstrap_project(project_root: Path) -> tuple[TestClient, str]:
    (project_root / "大纲").mkdir(parents=True, exist_ok=True)
    total_outline = "第一段剧情推进。\n\n第二段冲突升级。"
    (project_root / "大纲" / "总纲.md").write_text(total_outline, encoding="utf-8")
    app = FastAPI()
    app.include_router(outlines_router)
    return TestClient(app), total_outline


def _workspace_payload(project_root: Path) -> dict:
    return {"workspace_id": "ws-t06", "project_root": str(project_root)}


def _new_temp_project_root() -> Path:
    tests_dir = PACKAGE_ROOT / "dashboard" / "tests" / "_t06_runtime"
    tests_dir.mkdir(parents=True, exist_ok=True)
    project_root = tests_dir / f"t06-split-{uuid4().hex[:10]}"
    project_root.mkdir(parents=True, exist_ok=False)
    return project_root


def test_split_preview_apply_and_history_persistence():
    project_root = _new_temp_project_root()
    try:
        client, total_outline = _bootstrap_project(project_root)
        selection_start = 0
        selection_end = len(total_outline)

        preview_resp = client.post(
            "/api/outlines/split/preview",
            json={
                "workspace": _workspace_payload(project_root),
                "selection_start": selection_start,
                "selection_end": selection_end,
                "selection_text": total_outline,
            },
        )
        assert preview_resp.status_code == 200
        preview_body = preview_resp.json()
        assert preview_body["status"] == "ok"
        assert len(preview_body["segments"]) == 2
        assert len(preview_body["anchors"]) == 2
        assert preview_body["segments"][0]["order_index"] == 0

        apply_resp = client.post(
            "/api/outlines/split/apply",
            json={
                "workspace": _workspace_payload(project_root),
                "selection_start": selection_start,
                "selection_end": selection_end,
                "idempotency_key": "apply-key-1",
            },
        )
        assert apply_resp.status_code == 200
        apply_body = apply_resp.json()
        assert apply_body["status"] == "ok"
        split_record = apply_body["record"]

        split_map_path = project_root / ".webnovel" / "outlines" / "split-map.json"
        assert split_map_path.is_file()
        split_map = json.loads(split_map_path.read_text(encoding="utf-8"))
        assert len(split_map["records"]) == 1
        assert split_map["records"][0]["id"] == split_record["id"]
        assert split_map["records"][0]["target_segment_ids"] == [item["id"] for item in split_record["segments"]]

        detailed_segments_path = project_root / ".webnovel" / "outlines" / "detailed-segments.jsonl"
        assert detailed_segments_path.is_file()
        segment_entries = [
            json.loads(line)
            for line in detailed_segments_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        assert len(segment_entries) == 2
        assert [item["order_index"] for item in segment_entries] == [0, 1]

        detailed_outline_path = project_root / "大纲" / "细纲.md"
        assert detailed_outline_path.is_file()
        detailed_outline = detailed_outline_path.read_text(encoding="utf-8")
        assert "[0000]" in detailed_outline
        assert "[0001]" in detailed_outline

        history_resp = client.get(
            "/api/outlines/splits",
            params={
                "workspace_id": "ws-t06",
                "project_root": str(project_root),
                "limit": 100,
                "offset": 0,
            },
        )
        assert history_resp.status_code == 200
        history_body = history_resp.json()
        assert history_body["status"] == "ok"
        assert history_body["total"] == 1
        assert history_body["items"][0]["id"] == split_record["id"]
    finally:
        shutil.rmtree(project_root, ignore_errors=True)


def test_split_apply_is_idempotent_with_same_key():
    project_root = _new_temp_project_root()
    try:
        client, total_outline = _bootstrap_project(project_root)
        apply_payload = {
            "workspace": _workspace_payload(project_root),
            "selection_start": 0,
            "selection_end": len(total_outline),
            "idempotency_key": "duplicate-key",
        }

        first_resp = client.post("/api/outlines/split/apply", json=apply_payload)
        second_resp = client.post("/api/outlines/split/apply", json=apply_payload)
        assert first_resp.status_code == 200
        assert second_resp.status_code == 200
        assert first_resp.json()["record"]["id"] == second_resp.json()["record"]["id"]

        split_map_path = project_root / ".webnovel" / "outlines" / "split-map.json"
        split_map = json.loads(split_map_path.read_text(encoding="utf-8"))
        assert len(split_map["records"]) == 1

        detailed_segments_path = project_root / ".webnovel" / "outlines" / "detailed-segments.jsonl"
        entries = [
            json.loads(line)
            for line in detailed_segments_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        assert len(entries) == len(first_resp.json()["record"]["segments"])
    finally:
        shutil.rmtree(project_root, ignore_errors=True)
