#!/usr/bin/env python3

"""
Codex runtime migration.

目标：
- 将项目/工作区内历史 legacy 运行时痕迹收敛到 `.codex` 优先路径。
- 产出可追踪的迁移报告（含 dry-run）。
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from project_locator import CURRENT_PROJECT_POINTER_FILE
from runtime_compat import normalize_windows_path
from security_utils import atomic_write_json

LEGACY_CONTEXT_DIR = ".claude"
TARGET_CONTEXT_DIR = ".codex"
REPORT_DIR_REL = Path(".webnovel") / "migrations"


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _timestamp_token() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S-%f")


def _normalize_path(path: Path) -> Path:
    normalized = normalize_windows_path(str(path)).expanduser()
    try:
        return normalized.resolve()
    except Exception:
        return normalized


def _is_project_root(path: Path) -> bool:
    return (path / ".webnovel" / "state.json").is_file()


def _record_move(report: dict, *, kind: str, src: Path, dst: Path, dry_run: bool) -> None:
    report["moved"].append(
        {
            "kind": kind,
            "from": str(src),
            "to": str(dst),
            "dry_run": dry_run,
        }
    )


def _record_remove(report: dict, *, kind: str, target: Path, reason: str, dry_run: bool) -> None:
    report["removed"].append(
        {
            "kind": kind,
            "path": str(target),
            "reason": reason,
            "dry_run": dry_run,
        }
    )


def _record_skip(report: dict, *, kind: str, target: Path, reason: str) -> None:
    report["skipped"].append(
        {
            "kind": kind,
            "path": str(target),
            "reason": reason,
        }
    )


def _warn(report: dict, message: str) -> None:
    report["warnings"].append(message)


def _workspace_candidates(project_root: Path, workspace_hint: Path | None) -> list[Path]:
    candidates: list[Path] = []
    if workspace_hint is not None:
        candidates.append(_normalize_path(workspace_hint))
    candidates.append(project_root)
    parent = project_root.parent
    if parent != project_root:
        candidates.append(parent)

    deduped: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate).lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def _pointer_target(raw: str, *, pointer_parent: Path) -> str:
    target = normalize_windows_path(raw).expanduser()
    if not target.is_absolute():
        try:
            target = (pointer_parent / target).resolve()
        except Exception:
            target = pointer_parent / target
    try:
        target = target.resolve()
    except Exception:
        target = target
    return str(target)


def _maybe_remove_empty_dir(path: Path, *, report: dict, dry_run: bool) -> None:
    if not path.is_dir():
        return
    try:
        has_children = any(path.iterdir())
    except Exception:
        return
    if has_children:
        return
    _record_remove(
        report,
        kind="directory",
        target=path,
        reason="empty legacy directory",
        dry_run=dry_run,
    )
    if not dry_run:
        try:
            path.rmdir()
        except Exception:
            _warn(report, f"failed to remove empty directory: {path}")


def _migrate_workspace_pointer(workspace_root: Path, *, report: dict, dry_run: bool) -> None:
    legacy_pointer = workspace_root / LEGACY_CONTEXT_DIR / CURRENT_PROJECT_POINTER_FILE
    codex_pointer = workspace_root / TARGET_CONTEXT_DIR / CURRENT_PROJECT_POINTER_FILE

    if not legacy_pointer.is_file():
        return

    if codex_pointer.exists():
        legacy_raw = legacy_pointer.read_text(encoding="utf-8").strip()
        codex_raw = codex_pointer.read_text(encoding="utf-8").strip()
        legacy_target = _pointer_target(legacy_raw, pointer_parent=legacy_pointer.parent)
        codex_target = _pointer_target(codex_raw, pointer_parent=codex_pointer.parent)
        if legacy_target == codex_target:
            _record_remove(
                report,
                kind="workspace_pointer",
                target=legacy_pointer,
                reason="codex pointer already matches legacy pointer",
                dry_run=dry_run,
            )
            if not dry_run:
                legacy_pointer.unlink(missing_ok=True)
                _maybe_remove_empty_dir(legacy_pointer.parent, report=report, dry_run=dry_run)
            return

        _record_skip(
            report,
            kind="workspace_pointer",
            target=legacy_pointer,
            reason="codex pointer exists with different target",
        )
        _warn(
            report,
            f"pointer conflict detected, keep both files: {legacy_pointer} vs {codex_pointer}",
        )
        return

    _record_move(
        report,
        kind="workspace_pointer",
        src=legacy_pointer,
        dst=codex_pointer,
        dry_run=dry_run,
    )
    if not dry_run:
        codex_pointer.parent.mkdir(parents=True, exist_ok=True)
        legacy_pointer.rename(codex_pointer)
        _maybe_remove_empty_dir(legacy_pointer.parent, report=report, dry_run=dry_run)


def _same_file_content(a: Path, b: Path) -> bool:
    try:
        return a.read_bytes() == b.read_bytes()
    except Exception:
        return False


def _cleanup_empty_parent_dirs(start: Path, stop: Path, *, report: dict, dry_run: bool) -> None:
    current = start
    while True:
        if current == stop:
            break
        _maybe_remove_empty_dir(current, report=report, dry_run=dry_run)
        if current.parent == current:
            break
        current = current.parent


def _migrate_project_references(project_root: Path, *, report: dict, dry_run: bool) -> None:
    legacy_refs = project_root / LEGACY_CONTEXT_DIR / "references"
    codex_refs = project_root / TARGET_CONTEXT_DIR / "references"

    if not legacy_refs.exists():
        return
    if not legacy_refs.is_dir():
        _record_skip(
            report,
            kind="references",
            target=legacy_refs,
            reason="legacy references path is not a directory",
        )
        return

    if not codex_refs.exists():
        _record_move(
            report,
            kind="references_directory",
            src=legacy_refs,
            dst=codex_refs,
            dry_run=dry_run,
        )
        if not dry_run:
            codex_refs.parent.mkdir(parents=True, exist_ok=True)
            legacy_refs.rename(codex_refs)
            _cleanup_empty_parent_dirs(legacy_refs.parent, project_root, report=report, dry_run=dry_run)
        return

    if not codex_refs.is_dir():
        _record_skip(
            report,
            kind="references",
            target=codex_refs,
            reason="codex references path exists but is not a directory",
        )
        _warn(report, f"skip references migration because target is not directory: {codex_refs}")
        return

    for legacy_file in sorted(legacy_refs.rglob("*")):
        if not legacy_file.is_file():
            continue
        rel = legacy_file.relative_to(legacy_refs)
        target_file = codex_refs / rel

        if target_file.exists():
            if _same_file_content(legacy_file, target_file):
                _record_remove(
                    report,
                    kind="references_file",
                    target=legacy_file,
                    reason="duplicate file already exists in codex references",
                    dry_run=dry_run,
                )
                if not dry_run:
                    legacy_file.unlink(missing_ok=True)
                continue

            _record_skip(
                report,
                kind="references_file",
                target=legacy_file,
                reason="target file already exists with different content",
            )
            _warn(report, f"references file conflict: {legacy_file} -> {target_file}")
            continue

        _record_move(
            report,
            kind="references_file",
            src=legacy_file,
            dst=target_file,
            dry_run=dry_run,
        )
        if not dry_run:
            target_file.parent.mkdir(parents=True, exist_ok=True)
            legacy_file.rename(target_file)

    if not dry_run:
        for folder in sorted(legacy_refs.rglob("*"), reverse=True):
            if folder.is_dir():
                _maybe_remove_empty_dir(folder, report=report, dry_run=dry_run)
    _maybe_remove_empty_dir(legacy_refs, report=report, dry_run=dry_run)
    _cleanup_empty_parent_dirs(legacy_refs.parent, project_root, report=report, dry_run=dry_run)


def _write_report(project_root: Path, report: dict) -> Path:
    report_dir = project_root / REPORT_DIR_REL
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f"codex-migrate-{_timestamp_token()}.json"
    payload = dict(report)
    payload["report_path"] = str(report_path)
    atomic_write_json(report_path, payload, backup=False)
    return report_path


def migrate_codex_runtime(
    *,
    project_root: Path,
    dry_run: bool = False,
    workspace_hint: Path | None = None,
    persist_report: bool = True,
) -> dict:
    root = _normalize_path(project_root)
    if not _is_project_root(root):
        raise FileNotFoundError(f"Not a webnovel project root (missing .webnovel/state.json): {root}")

    report: dict = {
        "moved": [],
        "removed": [],
        "skipped": [],
        "warnings": [],
        "created_at": _now_iso(),
        "dry_run": bool(dry_run),
        "project_root": str(root),
    }

    for workspace_root in _workspace_candidates(root, workspace_hint):
        _migrate_workspace_pointer(workspace_root, report=report, dry_run=dry_run)
        _maybe_remove_empty_dir(workspace_root / LEGACY_CONTEXT_DIR, report=report, dry_run=dry_run)

    _migrate_project_references(root, report=report, dry_run=dry_run)
    _maybe_remove_empty_dir(root / LEGACY_CONTEXT_DIR, report=report, dry_run=dry_run)

    if persist_report:
        report_path = _write_report(root, report)
        report["report_path"] = str(report_path)
    else:
        report["report_path"] = ""
    return report
