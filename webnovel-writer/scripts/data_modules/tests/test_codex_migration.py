#!/usr/bin/env python3

import json
import shutil
import sys
from pathlib import Path
from uuid import uuid4

import pytest

TEST_TMP_ROOT = Path(__file__).resolve().parent / ".tmp" / "codex-migration"


@pytest.fixture
def tmp_path():
    TEST_TMP_ROOT.mkdir(parents=True, exist_ok=True)
    case_root = (TEST_TMP_ROOT / f"case-{uuid4().hex[:8]}").resolve()
    case_root.mkdir(parents=True, exist_ok=False)
    try:
        yield case_root
    finally:
        shutil.rmtree(case_root, ignore_errors=True)


def _ensure_scripts_on_path() -> None:
    scripts_dir = Path(__file__).resolve().parents[2]
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))


def _migration_context_dirs() -> tuple[str, str]:
    _ensure_scripts_on_path()
    from migrations.codex_migration import LEGACY_CONTEXT_DIR, TARGET_CONTEXT_DIR

    return LEGACY_CONTEXT_DIR, TARGET_CONTEXT_DIR


def _prepare_workspace_and_project(tmp_path):
    legacy_context_dir, _ = _migration_context_dirs()
    workspace_root = (tmp_path / "workspace").resolve()
    project_root = (workspace_root / "凡人资本论").resolve()

    (project_root / ".webnovel").mkdir(parents=True, exist_ok=True)
    (project_root / ".webnovel" / "state.json").write_text("{}", encoding="utf-8")

    (workspace_root / legacy_context_dir).mkdir(parents=True, exist_ok=True)
    (workspace_root / legacy_context_dir / ".webnovel-current-project").write_text(
        str(project_root),
        encoding="utf-8",
    )

    legacy_refs = project_root / legacy_context_dir / "references"
    legacy_refs.mkdir(parents=True, exist_ok=True)
    (legacy_refs / "world.md").write_text("# world", encoding="utf-8")

    return workspace_root, project_root


def test_codex_migration_dry_run_generates_report(tmp_path):
    _ensure_scripts_on_path()

    from migrations.codex_migration import migrate_codex_runtime

    workspace_root, project_root = _prepare_workspace_and_project(tmp_path)
    legacy_context_dir, target_context_dir = _migration_context_dirs()
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

    assert (workspace_root / legacy_context_dir / ".webnovel-current-project").is_file()
    assert not (workspace_root / target_context_dir / ".webnovel-current-project").exists()
    assert (project_root / legacy_context_dir / "references" / "world.md").is_file()
    assert not (project_root / target_context_dir / "references" / "world.md").exists()
    assert report["moved"]


def test_codex_migration_apply_moves_pointer_and_references(tmp_path):
    _ensure_scripts_on_path()

    from migrations.codex_migration import migrate_codex_runtime

    workspace_root, project_root = _prepare_workspace_and_project(tmp_path)
    legacy_context_dir, target_context_dir = _migration_context_dirs()
    report = migrate_codex_runtime(
        project_root=project_root,
        workspace_hint=workspace_root,
        dry_run=False,
    )

    legacy_pointer = workspace_root / legacy_context_dir / ".webnovel-current-project"
    codex_pointer = workspace_root / target_context_dir / ".webnovel-current-project"
    assert not legacy_pointer.exists()
    assert codex_pointer.is_file()
    assert codex_pointer.read_text(encoding="utf-8").strip() == str(project_root)

    assert not (project_root / legacy_context_dir / "references" / "world.md").exists()
    assert (project_root / target_context_dir / "references" / "world.md").is_file()

    assert report["moved"]
    assert Path(report["report_path"]).is_file()


def test_codex_migration_rejects_project_without_state_json(tmp_path):
    _ensure_scripts_on_path()

    from migrations.codex_migration import migrate_codex_runtime

    invalid_root = (tmp_path / "workspace").resolve()
    (invalid_root / ".webnovel").mkdir(parents=True, exist_ok=True)

    with pytest.raises(FileNotFoundError) as exc:
        migrate_codex_runtime(project_root=invalid_root, dry_run=True)

    assert "missing .webnovel/state.json" in str(exc.value)
