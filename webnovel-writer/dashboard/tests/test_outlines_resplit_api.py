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


def _new_temp_project_root() -> Path:
    tests_dir = PACKAGE_ROOT / "dashboard" / "tests" / "_t10_runtime"
    tests_dir.mkdir(parents=True, exist_ok=True)
    project_root = tests_dir / f"t10-resplit-{uuid4().hex[:10]}"
    project_root.mkdir(parents=True, exist_ok=False)
    return project_root


def _workspace_payload(project_root: Path) -> dict[str, str]:
    return {"workspace_id": "ws-t10", "project_root": str(project_root)}


def _bootstrap_project(project_root: Path) -> tuple[TestClient, str]:
    (project_root / "大纲").mkdir(parents=True, exist_ok=True)
    total_outline = "第一段剧情推进。\n\n第二段冲突升级。\n\n第三段高潮收束。"
    (project_root / "大纲" / "总纲.md").write_text(total_outline, encoding="utf-8")
    app = FastAPI()
    app.include_router(outlines_router)
    return TestClient(app), total_outline


def _apply_split(client: TestClient, project_root: Path, selection_start: int, selection_end: int, key: str) -> dict:
    response = client.post(
        "/api/outlines/split/apply",
        json={
            "workspace": _workspace_payload(project_root),
            "selection_start": selection_start,
            "selection_end": selection_end,
            "idempotency_key": key,
        },
    )
    assert response.status_code == 200
    return response.json()["record"]


def _read_split_map(project_root: Path) -> dict:
    split_map_path = project_root / ".webnovel" / "outlines" / "split-map.json"
    return json.loads(split_map_path.read_text(encoding="utf-8"))


def _read_detailed_entries(project_root: Path) -> list[dict]:
    detailed_segments_path = project_root / ".webnovel" / "outlines" / "detailed-segments.jsonl"
    return [
        json.loads(line)
        for line in detailed_segments_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _write_detailed_entries(project_root: Path, entries: list[dict]) -> None:
    detailed_segments_path = project_root / ".webnovel" / "outlines" / "detailed-segments.jsonl"
    detailed_segments_path.write_text(
        "".join(json.dumps(entry, ensure_ascii=False) + "\n" for entry in entries),
        encoding="utf-8",
    )


def test_resplit_smaller_selection_persists_strategy_and_history():
    project_root = _new_temp_project_root()
    try:
        client, total_outline = _bootstrap_project(project_root)
        _apply_split(client, project_root, 0, len(total_outline), "initial-full")

        first_break = total_outline.index("\n\n")
        selection_start = 1
        selection_end = max(selection_start + 1, first_break - 1)
        preview_response = client.post(
            "/api/outlines/resplit/preview",
            json={
                "workspace": _workspace_payload(project_root),
                "selection_start": selection_start,
                "selection_end": selection_end,
            },
        )
        assert preview_response.status_code == 200
        preview_body = preview_response.json()
        assert preview_body["status"] == "ok"
        assert preview_body["rollback_plan"]["rollback_strategy"] == "smaller_selection"
        assert preview_body["rollback_plan"]["rollback_start"] == 0
        assert preview_body["rollback_plan"]["rollback_end"] == len(total_outline)
        assert len(preview_body["segments"]) >= 2

        apply_response = client.post(
            "/api/outlines/resplit/apply",
            json={
                "workspace": _workspace_payload(project_root),
                "rollback_plan": preview_body["rollback_plan"],
                "idempotency_key": "resplit-smaller-key",
            },
        )
        assert apply_response.status_code == 200
        apply_body = apply_response.json()
        assert apply_body["status"] == "ok"

        validate_response = client.post(
            "/api/outlines/order/validate",
            json={
                "workspace": _workspace_payload(project_root),
                "segments": apply_body["record"]["segments"],
            },
        )
        assert validate_response.status_code == 200
        validate_body = validate_response.json()
        assert validate_body["status"] == "ok"
        assert validate_body["valid"] is True
        assert validate_body["conflicts"] == []

        split_map = _read_split_map(project_root)
        assert len(split_map["records"]) == 1
        assert split_map["records"][0]["rollback_strategy"] == "smaller_selection"
        assert len(split_map["history"]) == 1
        assert split_map["history"][0]["rollback_strategy"] == "smaller_selection"

        entries = _read_detailed_entries(project_root)
        assert [item["order_index"] for item in entries] == list(range(len(entries)))
    finally:
        shutil.rmtree(project_root, ignore_errors=True)


def test_resplit_larger_selection_uses_larger_strategy():
    project_root = _new_temp_project_root()
    try:
        client, total_outline = _bootstrap_project(project_root)
        first_break = total_outline.index("\n\n")
        second_start = first_break + 2
        second_break = total_outline.find("\n\n", second_start)
        if second_break == -1:
            second_break = len(total_outline)

        _apply_split(client, project_root, 0, first_break, "initial-first")
        preview_response = client.post(
            "/api/outlines/resplit/preview",
            json={
                "workspace": _workspace_payload(project_root),
                "selection_start": 0,
                "selection_end": second_break,
            },
        )
        assert preview_response.status_code == 200
        preview_body = preview_response.json()
        assert preview_body["rollback_plan"]["rollback_strategy"] == "larger_selection"
        assert preview_body["rollback_plan"]["rollback_start"] == 0
        assert preview_body["rollback_plan"]["rollback_end"] == second_break

        apply_response = client.post(
            "/api/outlines/resplit/apply",
            json={
                "workspace": _workspace_payload(project_root),
                "rollback_plan": preview_body["rollback_plan"],
                "idempotency_key": "resplit-larger-key",
            },
        )
        assert apply_response.status_code == 200

        split_map = _read_split_map(project_root)
        assert len(split_map["records"]) == 1
        assert split_map["records"][0]["rollback_strategy"] == "larger_selection"
        assert split_map["history"][0]["rollback_strategy"] == "larger_selection"

        entries = _read_detailed_entries(project_root)
        assert [item["order_index"] for item in entries] == list(range(len(entries)))
    finally:
        shutil.rmtree(project_root, ignore_errors=True)


def test_resplit_apply_blocks_write_when_order_validation_fails():
    project_root = _new_temp_project_root()
    try:
        client, total_outline = _bootstrap_project(project_root)
        first_break = total_outline.index("\n\n")
        second_start = first_break + 2
        second_break = total_outline.find("\n\n", second_start)
        if second_break == -1:
            second_break = len(total_outline)

        _apply_split(client, project_root, 0, first_break, "initial-first")
        second_record = _apply_split(client, project_root, second_start, second_break, "initial-second")

        preview_response = client.post(
            "/api/outlines/resplit/preview",
            json={
                "workspace": _workspace_payload(project_root),
                "selection_start": 1,
                "selection_end": max(2, first_break - 1),
            },
        )
        assert preview_response.status_code == 200
        preview_body = preview_response.json()
        assert preview_body["rollback_plan"]["rollback_strategy"] == "smaller_selection"

        entries = _read_detailed_entries(project_root)
        for entry in entries:
            if entry.get("source_split_id") == second_record["id"]:
                entry.pop("source_anchor", None)
                break
        _write_detailed_entries(project_root, entries)

        apply_response = client.post(
            "/api/outlines/resplit/apply",
            json={
                "workspace": _workspace_payload(project_root),
                "rollback_plan": preview_body["rollback_plan"],
                "idempotency_key": "resplit-conflict-key",
            },
        )
        assert apply_response.status_code == 409
        detail = apply_response.json()["detail"]
        assert detail["error_code"] == "OUTLINE_ORDER_CONFLICT"

        split_map = _read_split_map(project_root)
        assert len(split_map["records"]) == 2
        assert split_map["history"] == []
    finally:
        shutil.rmtree(project_root, ignore_errors=True)

