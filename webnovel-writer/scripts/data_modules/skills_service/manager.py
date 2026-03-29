"""
Skill registry and audit management.
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

_PLUGIN_ROOT = Path(__file__).resolve().parents[3]
_SCRIPTS_DIR = _PLUGIN_ROOT / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from security_utils import atomic_write_json

try:
    from filelock import FileLock
except Exception:  # pragma: no cover - fallback when dependency is absent
    FileLock = None


_SKILL_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_SKILL_NAME_CONTROL_PATTERN = re.compile(r"[\x00-\x1f\x7f]")
_SKILL_NAME_MAX_LENGTH = 80


@dataclass(frozen=True)
class SkillPaths:
    webnovel_dir: Path
    skills_dir: Path
    registry_path: Path
    logs_dir: Path
    audit_path: Path


class SkillServiceError(Exception):
    def __init__(
        self,
        *,
        status_code: int,
        error_code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.message = message
        self.details = details


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _normalize_root(path: Path | str) -> Path:
    return Path(path).expanduser().resolve()


def _resolve_workspace(
    *,
    runtime_project_root: Path | str,
    workspace_id: str,
    workspace_project_root: str | None,
) -> tuple[str, Path]:
    if not workspace_id or not workspace_id.strip():
        raise SkillServiceError(
            status_code=400,
            error_code="invalid_workspace_id",
            message="workspace_id is required.",
        )

    runtime_root = _normalize_root(runtime_project_root)
    if workspace_project_root and workspace_project_root.strip():
        requested_root = _normalize_root(workspace_project_root)
        if requested_root != runtime_root:
            raise SkillServiceError(
                status_code=403,
                error_code="workspace_mismatch",
                message="Workspace access denied.",
                details={
                    "requested_project_root": str(requested_root),
                    "runtime_project_root": str(runtime_root),
                },
            )
    return workspace_id.strip(), runtime_root


def _paths(project_root: Path) -> SkillPaths:
    webnovel_dir = project_root / ".webnovel"
    skills_dir = webnovel_dir / "skills"
    return SkillPaths(
        webnovel_dir=webnovel_dir,
        skills_dir=skills_dir,
        registry_path=skills_dir / "registry.json",
        logs_dir=webnovel_dir / "logs",
        audit_path=webnovel_dir / "logs" / "skill-audit.jsonl",
    )


def _ensure_dirs(paths: SkillPaths) -> None:
    paths.webnovel_dir.mkdir(parents=True, exist_ok=True)
    paths.skills_dir.mkdir(parents=True, exist_ok=True)
    paths.logs_dir.mkdir(parents=True, exist_ok=True)
    state_path = paths.webnovel_dir / "state.json"
    if not state_path.exists():
        state_path.write_text("{}", encoding="utf-8")


def _normalize_skill(raw: dict[str, Any]) -> dict[str, Any]:
    now = _utc_now()
    skill_id = str(raw.get("id", "")).strip()
    if not skill_id:
        return {}
    return {
        "id": skill_id,
        "name": str(raw.get("name", "") or skill_id),
        "description": str(raw.get("description", "") or ""),
        "enabled": bool(raw.get("enabled", False)),
        "scope": str(raw.get("scope", "workspace") or "workspace"),
        "updated_at": str(raw.get("updated_at", now) or now),
        "last_called_at": raw.get("last_called_at"),
    }


def _default_registry(*, workspace_id: str, project_root: Path) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "workspace_id": workspace_id,
        "project_root": str(project_root),
        "updated_at": _utc_now(),
        "items": [],
    }


def _load_registry(*, paths: SkillPaths, workspace_id: str, project_root: Path) -> dict[str, Any]:
    if not paths.registry_path.is_file():
        return _default_registry(workspace_id=workspace_id, project_root=project_root)

    try:
        raw = json.loads(paths.registry_path.read_text(encoding="utf-8") or "{}")
    except json.JSONDecodeError as exc:
        raise SkillServiceError(
            status_code=500,
            error_code="registry_corrupted",
            message="Skill registry is corrupted.",
            details={"path": str(paths.registry_path), "error": str(exc)},
        ) from exc

    registry = _default_registry(workspace_id=workspace_id, project_root=project_root)
    if isinstance(raw, list):
        raw_items = raw
    elif isinstance(raw, dict):
        raw_items = raw.get("items", raw.get("skills", []))
    else:
        raw_items = []

    items: list[dict[str, Any]] = []
    for item in raw_items if isinstance(raw_items, list) else []:
        if not isinstance(item, dict):
            continue
        normalized = _normalize_skill(item)
        if normalized:
            items.append(normalized)

    registry["items"] = items
    return registry


def _save_registry(paths: SkillPaths, registry: dict[str, Any]) -> None:
    registry["updated_at"] = _utc_now()
    atomic_write_json(paths.registry_path, registry, backup=False)


def _validate_skill_id(skill_id: str) -> str:
    normalized = (skill_id or "").strip()
    if not _SKILL_ID_PATTERN.fullmatch(normalized):
        raise SkillServiceError(
            status_code=400,
            error_code="invalid_skill_id",
            message="skill id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}.",
            details={"skill_id": skill_id},
        )
    return normalized


def _validate_skill_name(name: str) -> str:
    normalized = (name or "").strip()
    if not normalized:
        raise SkillServiceError(
            status_code=400,
            error_code="invalid_skill_name",
            message="skill name must not be empty.",
        )
    if len(normalized) > _SKILL_NAME_MAX_LENGTH:
        raise SkillServiceError(
            status_code=400,
            error_code="invalid_skill_name",
            message=f"skill name must be <= {_SKILL_NAME_MAX_LENGTH} characters.",
            details={"max_length": _SKILL_NAME_MAX_LENGTH},
        )
    if _SKILL_NAME_CONTROL_PATTERN.search(normalized):
        raise SkillServiceError(
            status_code=400,
            error_code="invalid_skill_name",
            message="skill name contains control characters.",
        )
    return normalized


def _skill_dir(paths: SkillPaths, skill_id: str) -> Path:
    return paths.skills_dir / skill_id


def _write_skill_files(
    *,
    paths: SkillPaths,
    skill: dict[str, Any],
    skill_markdown: str | None,
) -> None:
    folder = _skill_dir(paths, skill["id"])
    folder.mkdir(parents=True, exist_ok=True)

    skill_md_path = folder / "SKILL.md"
    if skill_markdown is not None:
        skill_md_path.write_text(skill_markdown, encoding="utf-8")
    elif not skill_md_path.exists():
        skill_md_path.write_text(f"# {skill['name']}\n\n{skill['description']}\n", encoding="utf-8")

    atomic_write_json(folder / "meta.json", skill, backup=False)


def _append_audit(paths: SkillPaths, entry: dict[str, Any]) -> None:
    payload = json.dumps(entry, ensure_ascii=False)
    lock_path = str(paths.audit_path) + ".lock"
    if FileLock is not None:
        with FileLock(lock_path, timeout=10), paths.audit_path.open("a", encoding="utf-8") as handle:
            handle.write(payload + "\n")
        return

    with paths.audit_path.open("a", encoding="utf-8") as handle:
        handle.write(payload + "\n")


def _record_audit(
    *,
    paths: SkillPaths,
    workspace_id: str,
    project_root: Path,
    action: str,
    skill_id: str,
    actor: str,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    entry = {
        "id": f"audit-{uuid4().hex}",
        "action": action,
        "skill_id": skill_id,
        "actor": actor,
        "created_at": _utc_now(),
        "details": {
            "workspace_id": workspace_id,
            "project_root": str(project_root),
            **(details or {}),
        },
    }
    _append_audit(paths, entry)
    return entry


def _find_skill_index(items: list[dict[str, Any]], skill_id: str) -> int:
    for idx, item in enumerate(items):
        if item.get("id") == skill_id:
            return idx
    return -1


def _find_skill_name_conflict(
    items: list[dict[str, Any]],
    *,
    name: str,
    exclude_skill_id: str | None = None,
) -> str | None:
    normalized = name.casefold()
    for item in items:
        item_id = str(item.get("id", ""))
        if exclude_skill_id and item_id == exclude_skill_id:
            continue
        if str(item.get("name", "")).strip().casefold() == normalized:
            return item_id
    return None


def _parse_time_filter(*, raw: str, field_name: str) -> datetime:
    value = raw.strip()
    if value.endswith("Z"):
        value = f"{value[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise SkillServiceError(
            status_code=400,
            error_code="invalid_audit_time",
            message=f"{field_name} must be an ISO 8601 datetime.",
            details={field_name: raw},
        ) from exc
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _parse_optional_entry_time(raw: Any) -> datetime | None:
    text = str(raw or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def list_skills(
    *,
    runtime_project_root: Path | str,
    workspace_id: str,
    workspace_project_root: str | None,
    enabled: bool | None,
    limit: int,
    offset: int,
) -> tuple[list[dict[str, Any]], int]:
    workspace_id, project_root = _resolve_workspace(
        runtime_project_root=runtime_project_root,
        workspace_id=workspace_id,
        workspace_project_root=workspace_project_root,
    )
    paths = _paths(project_root)
    _ensure_dirs(paths)
    registry = _load_registry(paths=paths, workspace_id=workspace_id, project_root=project_root)

    items = list(registry["items"])
    if enabled is not None:
        items = [item for item in items if bool(item.get("enabled")) is enabled]

    items.sort(key=lambda item: str(item.get("updated_at", "")), reverse=True)
    total = len(items)
    sliced = items[offset : offset + limit]
    return sliced, total


def create_skill(
    *,
    runtime_project_root: Path | str,
    workspace_id: str,
    workspace_project_root: str | None,
    skill_id: str,
    name: str,
    description: str,
    enabled: bool,
    actor: str = "api",
    skill_markdown: str | None = None,
) -> dict[str, Any]:
    workspace_id, project_root = _resolve_workspace(
        runtime_project_root=runtime_project_root,
        workspace_id=workspace_id,
        workspace_project_root=workspace_project_root,
    )
    normalized_id = _validate_skill_id(skill_id)
    normalized_name = _validate_skill_name(name or normalized_id)
    paths = _paths(project_root)
    _ensure_dirs(paths)
    registry = _load_registry(paths=paths, workspace_id=workspace_id, project_root=project_root)
    items = registry["items"]

    if _find_skill_index(items, normalized_id) >= 0:
        raise SkillServiceError(
            status_code=409,
            error_code="skill_id_conflict",
            message="Skill id already exists.",
            details={"skill_id": normalized_id},
        )
    conflict_id = _find_skill_name_conflict(items, name=normalized_name)
    if conflict_id is not None:
        raise SkillServiceError(
            status_code=409,
            error_code="skill_name_conflict",
            message="Skill name already exists.",
            details={"name": normalized_name, "conflict_skill_id": conflict_id},
        )

    now = _utc_now()
    skill = {
        "id": normalized_id,
        "name": normalized_name,
        "description": (description or "").strip(),
        "enabled": bool(enabled),
        "scope": "workspace",
        "updated_at": now,
        "last_called_at": None,
    }
    items.append(skill)
    _save_registry(paths, registry)
    _write_skill_files(paths=paths, skill=skill, skill_markdown=skill_markdown)
    _record_audit(
        paths=paths,
        workspace_id=workspace_id,
        project_root=project_root,
        action="create",
        skill_id=normalized_id,
        actor=actor,
        details={"enabled": bool(enabled)},
    )
    return skill


def update_skill(
    *,
    runtime_project_root: Path | str,
    workspace_id: str,
    workspace_project_root: str | None,
    skill_id: str,
    name: str | None,
    description: str | None,
    enabled: bool | None,
    actor: str = "api",
) -> dict[str, Any]:
    workspace_id, project_root = _resolve_workspace(
        runtime_project_root=runtime_project_root,
        workspace_id=workspace_id,
        workspace_project_root=workspace_project_root,
    )
    normalized_id = _validate_skill_id(skill_id)
    paths = _paths(project_root)
    _ensure_dirs(paths)
    registry = _load_registry(paths=paths, workspace_id=workspace_id, project_root=project_root)
    items = registry["items"]
    idx = _find_skill_index(items, normalized_id)
    if idx < 0:
        raise SkillServiceError(
            status_code=404,
            error_code="skill_not_found",
            message="Skill not found.",
            details={"skill_id": normalized_id},
        )

    skill = dict(items[idx])
    changed: dict[str, Any] = {}
    if name is not None:
        new_name = _validate_skill_name(name)
        conflict_id = _find_skill_name_conflict(
            items,
            name=new_name,
            exclude_skill_id=normalized_id,
        )
        if conflict_id is not None:
            raise SkillServiceError(
                status_code=409,
                error_code="skill_name_conflict",
                message="Skill name already exists.",
                details={"name": new_name, "conflict_skill_id": conflict_id},
            )
        if new_name != skill["name"]:
            skill["name"] = new_name
            changed["name"] = new_name
    if description is not None:
        new_desc = description.strip()
        if new_desc != skill["description"]:
            skill["description"] = new_desc
            changed["description"] = new_desc
    if enabled is not None and bool(enabled) != bool(skill["enabled"]):
        skill["enabled"] = bool(enabled)
        changed["enabled"] = bool(enabled)

    skill["updated_at"] = _utc_now()
    items[idx] = skill
    _save_registry(paths, registry)
    _write_skill_files(paths=paths, skill=skill, skill_markdown=None)
    _record_audit(
        paths=paths,
        workspace_id=workspace_id,
        project_root=project_root,
        action="update",
        skill_id=normalized_id,
        actor=actor,
        details={"changed_fields": changed},
    )
    return skill


def set_skill_enabled(
    *,
    runtime_project_root: Path | str,
    workspace_id: str,
    workspace_project_root: str | None,
    skill_id: str,
    enabled: bool,
    reason: str | None,
    actor: str = "api",
) -> dict[str, Any]:
    action = "enable" if enabled else "disable"
    return update_skill_with_action(
        runtime_project_root=runtime_project_root,
        workspace_id=workspace_id,
        workspace_project_root=workspace_project_root,
        skill_id=skill_id,
        enabled=enabled,
        action=action,
        reason=reason,
        actor=actor,
    )


def update_skill_with_action(
    *,
    runtime_project_root: Path | str,
    workspace_id: str,
    workspace_project_root: str | None,
    skill_id: str,
    enabled: bool,
    action: str,
    reason: str | None,
    actor: str,
) -> dict[str, Any]:
    workspace_id, project_root = _resolve_workspace(
        runtime_project_root=runtime_project_root,
        workspace_id=workspace_id,
        workspace_project_root=workspace_project_root,
    )
    normalized_id = _validate_skill_id(skill_id)
    paths = _paths(project_root)
    _ensure_dirs(paths)
    registry = _load_registry(paths=paths, workspace_id=workspace_id, project_root=project_root)
    items = registry["items"]
    idx = _find_skill_index(items, normalized_id)
    if idx < 0:
        raise SkillServiceError(
            status_code=404,
            error_code="skill_not_found",
            message="Skill not found.",
            details={"skill_id": normalized_id},
        )

    skill = dict(items[idx])
    skill["enabled"] = bool(enabled)
    skill["updated_at"] = _utc_now()
    items[idx] = skill
    _save_registry(paths, registry)
    _write_skill_files(paths=paths, skill=skill, skill_markdown=None)
    _record_audit(
        paths=paths,
        workspace_id=workspace_id,
        project_root=project_root,
        action=action,
        skill_id=normalized_id,
        actor=actor,
        details={"reason": reason or ""},
    )
    return skill


def delete_skill(
    *,
    runtime_project_root: Path | str,
    workspace_id: str,
    workspace_project_root: str | None,
    skill_id: str,
    hard_delete: bool,
    actor: str = "api",
) -> bool:
    workspace_id, project_root = _resolve_workspace(
        runtime_project_root=runtime_project_root,
        workspace_id=workspace_id,
        workspace_project_root=workspace_project_root,
    )
    normalized_id = _validate_skill_id(skill_id)
    paths = _paths(project_root)
    _ensure_dirs(paths)
    registry = _load_registry(paths=paths, workspace_id=workspace_id, project_root=project_root)
    items = registry["items"]
    idx = _find_skill_index(items, normalized_id)
    if idx < 0:
        raise SkillServiceError(
            status_code=404,
            error_code="skill_not_found",
            message="Skill not found.",
            details={"skill_id": normalized_id},
        )

    items.pop(idx)
    _save_registry(paths, registry)

    folder = _skill_dir(paths, normalized_id)
    if folder.exists():
        shutil.rmtree(folder)

    _record_audit(
        paths=paths,
        workspace_id=workspace_id,
        project_root=project_root,
        action="delete",
        skill_id=normalized_id,
        actor=actor,
        details={"hard_delete": bool(hard_delete)},
    )
    return True


def list_skill_audit(
    *,
    runtime_project_root: Path | str,
    workspace_id: str,
    workspace_project_root: str | None,
    action: str | None = None,
    actor: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    workspace_id, project_root = _resolve_workspace(
        runtime_project_root=runtime_project_root,
        workspace_id=workspace_id,
        workspace_project_root=workspace_project_root,
    )
    paths = _paths(project_root)
    _ensure_dirs(paths)
    if not paths.audit_path.is_file():
        return [], 0

    normalized_action = action.strip().casefold() if action and action.strip() else None
    normalized_actor = actor.strip().casefold() if actor and actor.strip() else None
    start_at = _parse_time_filter(raw=start_time, field_name="start_time") if start_time and start_time.strip() else None
    end_at = _parse_time_filter(raw=end_time, field_name="end_time") if end_time and end_time.strip() else None
    if start_at and end_at and start_at > end_at:
        raise SkillServiceError(
            status_code=400,
            error_code="invalid_audit_time_range",
            message="start_time must be earlier than or equal to end_time.",
            details={"start_time": start_time, "end_time": end_time},
        )

    items: list[dict[str, Any]] = []
    for line in paths.audit_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(entry, dict):
            continue
        details = entry.get("details")
        if isinstance(details, dict):
            if details.get("workspace_id") != workspace_id:
                continue
            if details.get("project_root") != str(project_root):
                continue
        entry_action = str(entry.get("action", "unknown"))
        entry_actor = str(entry.get("actor", "system"))
        if normalized_action and entry_action.casefold() != normalized_action:
            continue
        if normalized_actor and entry_actor.casefold() != normalized_actor:
            continue
        entry_created_at = str(entry.get("created_at", _utc_now()))
        entry_created_dt = _parse_optional_entry_time(entry_created_at)
        if start_at or end_at:
            if entry_created_dt is None:
                continue
            if start_at and entry_created_dt < start_at:
                continue
            if end_at and entry_created_dt > end_at:
                continue
        items.append(
            {
                "id": str(entry.get("id", f"audit-{uuid4().hex}")),
                "action": entry_action,
                "skill_id": str(entry.get("skill_id", "")),
                "actor": entry_actor,
                "created_at": entry_created_at,
                "details": details if isinstance(details, dict) else {},
            }
        )

    items = list(reversed(items))
    total = len(items)
    return items[offset : offset + limit], total
