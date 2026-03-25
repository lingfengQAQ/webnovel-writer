#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import importlib
import json
import shutil
import sys
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _ensure_paths() -> None:
    scripts_dir = Path(__file__).resolve().parents[2]
    repo_root = scripts_dir.parent
    for candidate in (str(repo_root), str(scripts_dir)):
        if candidate not in sys.path:
            sys.path.insert(0, candidate)


def _create_dashboard_client(project_root: Path) -> TestClient:
    _ensure_paths()
    from dashboard.routers.skills import router as skills_router

    app = FastAPI()
    app.state.project_root = str(project_root.resolve())
    app.include_router(skills_router)
    return TestClient(app)


def _workspace_payload(project_root: Path, workspace_id: str = "ws-test") -> dict:
    return {
        "workspace": {
            "workspace_id": workspace_id,
            "project_root": str(project_root),
        }
    }


@contextmanager
def _sandbox_dir():
    base = Path.cwd() / "tmp-write-check-2" / "t04-skill-tests"
    base.mkdir(parents=True, exist_ok=True)
    case_dir = base / f"case-{uuid4().hex}"
    case_dir.mkdir(parents=True, exist_ok=False)
    try:
        yield case_dir
    finally:
        shutil.rmtree(case_dir, ignore_errors=True)


def _run_cli(monkeypatch, capsys, args: list[str]) -> tuple[int, dict]:
    _ensure_paths()
    module = importlib.import_module("data_modules.skill_manager")
    module = importlib.reload(module)

    monkeypatch.setattr(sys, "argv", ["skill_manager", *args])
    with pytest.raises(SystemExit) as exc:
        module.main()

    stdout = capsys.readouterr().out.strip()
    payload = json.loads(stdout) if stdout else {}
    return int(exc.value.code or 0), payload


def test_skill_api_crud_persistence_and_audit():
    with _sandbox_dir() as tmp_path:
        project_root = tmp_path / "book-a"
        (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)

        with _create_dashboard_client(project_root) as client:
            create_payload = {
                **_workspace_payload(project_root, workspace_id="ws-a"),
                "id": "scene.splitter",
                "name": "Scene Splitter",
                "description": "Split outline text into scene beats.",
                "enabled": True,
            }
            create_resp = client.post("/api/skills", json=create_payload)
            assert create_resp.status_code == 200
            assert create_resp.json()["status"] == "ok"

            enabled_resp = client.get(
                "/api/skills",
                params={
                    "workspace_id": "ws-a",
                    "project_root": str(project_root),
                    "enabled": "true",
                },
            )
            assert enabled_resp.status_code == 200
            assert enabled_resp.json()["total"] == 1

            disable_resp = client.post(
                "/api/skills/scene.splitter/disable",
                json={**_workspace_payload(project_root, workspace_id="ws-a"), "reason": "maintenance"},
            )
            assert disable_resp.status_code == 200
            assert disable_resp.json()["enabled"] is False

            disabled_filtered = client.get(
                "/api/skills",
                params={
                    "workspace_id": "ws-a",
                    "project_root": str(project_root),
                    "enabled": "true",
                },
            )
            assert disabled_filtered.status_code == 200
            assert disabled_filtered.json()["total"] == 0

            audit_resp = client.get(
                "/api/skills/audit",
                params={"workspace_id": "ws-a", "project_root": str(project_root)},
            )
            assert audit_resp.status_code == 200
            actions = [item["action"] for item in audit_resp.json()["items"]]
            assert "create" in actions
            assert "disable" in actions

            delete_resp = client.request(
                "DELETE",
                "/api/skills/scene.splitter",
                json={**_workspace_payload(project_root, workspace_id="ws-a"), "hard_delete": True},
            )
            assert delete_resp.status_code == 200
            assert delete_resp.json()["deleted"] is True

        registry_path = project_root / ".webnovel" / "skills" / "registry.json"
        audit_path = project_root / ".webnovel" / "logs" / "skill-audit.jsonl"
        assert registry_path.is_file()
        assert audit_path.is_file()


def test_skill_api_workspace_isolation_ac002():
    with _sandbox_dir() as tmp_path:
        project_a = tmp_path / "workspace-a"
        project_b = tmp_path / "workspace-b"
        (project_a / ".webnovel").mkdir(parents=True, exist_ok=True)
        (project_b / ".webnovel").mkdir(parents=True, exist_ok=True)

        with _create_dashboard_client(project_a) as client_a:
            create_a = client_a.post(
                "/api/skills",
                json={
                    **_workspace_payload(project_a, workspace_id="ws-a"),
                    "id": "shared.skill",
                    "name": "Shared Skill",
                    "description": "A side skill in workspace A.",
                    "enabled": True,
                },
            )
            assert create_a.status_code == 200

            cross_workspace = client_a.get(
                "/api/skills",
                params={"workspace_id": "ws-a", "project_root": str(project_b)},
            )
            assert cross_workspace.status_code == 403
            assert cross_workspace.json()["error_code"] == "workspace_mismatch"

        with _create_dashboard_client(project_b) as client_b:
            list_b_before = client_b.get(
                "/api/skills",
                params={"workspace_id": "ws-b", "project_root": str(project_b)},
            )
            assert list_b_before.status_code == 200
            assert list_b_before.json()["total"] == 0

            create_b = client_b.post(
                "/api/skills",
                json={
                    **_workspace_payload(project_b, workspace_id="ws-b"),
                    "id": "shared.skill",
                    "name": "Shared Skill",
                    "description": "Same id but isolated workspace.",
                    "enabled": False,
                },
            )
            assert create_b.status_code == 200

            list_b_enabled = client_b.get(
                "/api/skills",
                params={
                    "workspace_id": "ws-b",
                    "project_root": str(project_b),
                    "enabled": "true",
                },
            )
            assert list_b_enabled.status_code == 200
            assert list_b_enabled.json()["total"] == 0

        with _create_dashboard_client(project_a) as client_a_again:
            list_a_enabled = client_a_again.get(
                "/api/skills",
                params={
                    "workspace_id": "ws-a",
                    "project_root": str(project_a),
                    "enabled": "true",
                },
            )
            assert list_a_enabled.status_code == 200
            assert list_a_enabled.json()["total"] == 1


def test_skill_manager_cli_flow(monkeypatch, capsys):
    with _sandbox_dir() as tmp_path:
        project_root = tmp_path / "book-cli"
        (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
        source_file = tmp_path / "source-skill.md"
        source_file.write_text("# CLI Skill\n\nFrom file.\n", encoding="utf-8")

        code, add_payload = _run_cli(
            monkeypatch,
            capsys,
            [
                "--project-root",
                str(project_root),
                "--workspace-id",
                "ws-cli",
                "add",
                "--id",
                "cli.skill",
                "--name",
                "CLI Skill",
                "--desc",
                "CLI managed skill",
                "--from",
                str(source_file),
                "--enabled",
                "true",
            ],
        )
        assert code == 0
        assert add_payload["status"] == "ok"

        code, list_payload = _run_cli(
            monkeypatch,
            capsys,
            [
                "--project-root",
                str(project_root),
                "--workspace-id",
                "ws-cli",
                "list",
                "--enabled",
                "true",
            ],
        )
        assert code == 0
        assert list_payload["total"] == 1

        code, disable_payload = _run_cli(
            monkeypatch,
            capsys,
            [
                "--project-root",
                str(project_root),
                "--workspace-id",
                "ws-cli",
                "disable",
                "--id",
                "cli.skill",
                "--reason",
                "test-disable",
            ],
        )
        assert code == 0
        assert disable_payload["enabled"] is False

        code, audit_payload = _run_cli(
            monkeypatch,
            capsys,
            [
                "--project-root",
                str(project_root),
                "--workspace-id",
                "ws-cli",
                "audit",
            ],
        )
        assert code == 0
        actions = [item["action"] for item in audit_payload["items"]]
        assert "create" in actions
        assert "disable" in actions

        code, remove_payload = _run_cli(
            monkeypatch,
            capsys,
            [
                "--project-root",
                str(project_root),
                "--workspace-id",
                "ws-cli",
                "remove",
                "--id",
                "cli.skill",
                "--hard-delete",
            ],
        )
        assert code == 0
        assert remove_payload["deleted"] is True

        registry_path = project_root / ".webnovel" / "skills" / "registry.json"
        audit_path = project_root / ".webnovel" / "logs" / "skill-audit.jsonl"
        assert registry_path.is_file()
        assert audit_path.is_file()
