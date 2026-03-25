#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import sys
from pathlib import Path


def _ensure_scripts_on_path() -> None:
    scripts_dir = Path(__file__).resolve().parents[2]
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))


def _prepare_workspace_and_project(tmp_path):
    workspace_root = (tmp_path / "workspace").resolve()
    project_root = (workspace_root / "凡人资本论").resolve()

    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    (workspace_root / ".claude").mkdir(parents=True, exist_ok=True)
    (workspace_root / ".claude" / ".webnovel-current-project").write_text(
        str(project_root),
        encoding="utf-8",
    )

    legacy_refs = project_root / ".claude" / "references"
    legacy_refs.mkdir(parents=True, exist_ok=True)
    (legacy_refs / "world.md").write_text("# world", encoding="utf-8")

    return workspace_root, project_root


def test_codex_migration_dry_run_generates_report(tmp_path):
    _ensure_scripts_on_path()

    from migrations.codex_migration import migrate_codex_runtime

    workspace_root, project_root = _prepare_workspace_and_project(tmp_path)
    report = migrate_codex_runtime(
        project_root=project_root,
        workspace_hint=workspace_root,
        dry_run=True,
    )

    report_path = Path(report["report_path"])
    assert report_path.is_file()

    persisted = json.loads(report_path.read_text(encoding="utf-8"))
    for key in ("moved", "removed", "skipped", "warnings", "created_at"):
        assert key in persisted

    assert (workspace_root / ".claude" / ".webnovel-current-project").is_file()
    assert not (workspace_root / ".codex" / ".webnovel-current-project").exists()
    assert (project_root / ".claude" / "references" / "world.md").is_file()
    assert not (project_root / ".codex" / "references" / "world.md").exists()
    assert report["moved"]


def test_codex_migration_apply_moves_pointer_and_references(tmp_path):
    _ensure_scripts_on_path()

    from migrations.codex_migration import migrate_codex_runtime

    workspace_root, project_root = _prepare_workspace_and_project(tmp_path)
    report = migrate_codex_runtime(
        project_root=project_root,
        workspace_hint=workspace_root,
        dry_run=False,
    )

    legacy_pointer = workspace_root / ".claude" / ".webnovel-current-project"
    codex_pointer = workspace_root / ".codex" / ".webnovel-current-project"
    assert not legacy_pointer.exists()
    assert codex_pointer.is_file()
    assert codex_pointer.read_text(encoding="utf-8").strip() == str(project_root)

    assert not (project_root / ".claude" / "references" / "world.md").exists()
    assert (project_root / ".codex" / "references" / "world.md").is_file()

    assert report["moved"]
    assert Path(report["report_path"]).is_file()

