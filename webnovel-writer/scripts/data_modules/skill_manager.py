#!/usr/bin/env python3
"""
Workspace skill manager CLI.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from project_locator import resolve_project_root


def _ensure_repo_on_path() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))


def _bool_arg(raw: str) -> bool:
    value = (raw or "").strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise argparse.ArgumentTypeError(f"invalid bool: {raw}")


def _service():
    _ensure_repo_on_path()
    from data_modules.skills_service import (
        SkillServiceError,
        create_skill,
        delete_skill,
        list_skill_audit,
        list_skills,
        set_skill_enabled,
        update_skill,
    )

    return {
        "error": SkillServiceError,
        "create": create_skill,
        "delete": delete_skill,
        "list": list_skills,
        "audit": list_skill_audit,
        "toggle": set_skill_enabled,
        "update": update_skill,
    }


def _print_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="skill_manager", description="Manage workspace skills")
    parser.add_argument("--project-root", default=None, help="workspace/project root path")
    parser.add_argument("--workspace-id", default="workspace-default", help="workspace id")
    parser.add_argument("--format", choices=["json", "text"], default="json", help="output format")

    sub = parser.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="list skills")
    p_list.add_argument("--enabled", type=_bool_arg, default=None, help="enabled filter")
    p_list.add_argument("--limit", type=int, default=50)
    p_list.add_argument("--offset", type=int, default=0)

    p_add = sub.add_parser("add", help="add skill")
    p_add.add_argument("--id", required=True)
    p_add.add_argument("--name", required=True)
    p_add.add_argument("--desc", default="")
    p_add.add_argument("--from", dest="source_path", default=None, help="source markdown path")
    p_add.add_argument("--enabled", type=_bool_arg, default=True)

    p_update = sub.add_parser("update", help="update skill")
    p_update.add_argument("--id", required=True)
    p_update.add_argument("--name", default=None)
    p_update.add_argument("--desc", default=None)
    p_update.add_argument("--enabled", type=_bool_arg, default=None)

    p_enable = sub.add_parser("enable", help="enable skill")
    p_enable.add_argument("--id", required=True)
    p_enable.add_argument("--reason", default=None)

    p_disable = sub.add_parser("disable", help="disable skill")
    p_disable.add_argument("--id", required=True)
    p_disable.add_argument("--reason", default=None)

    p_remove = sub.add_parser("remove", help="remove skill")
    p_remove.add_argument("--id", required=True)
    p_remove.add_argument("--hard-delete", action="store_true")

    p_audit = sub.add_parser("audit", help="list audit records")
    p_audit.add_argument("--limit", type=int, default=100)
    p_audit.add_argument("--offset", type=int, default=0)

    return parser


def _resolved_project_root(args: argparse.Namespace) -> Path:
    return resolve_project_root(args.project_root)


def _workspace_root_str(project_root: Path) -> str:
    return str(project_root.resolve())


def _cmd_list(args: argparse.Namespace) -> dict[str, Any]:
    svc = _service()
    project_root = _resolved_project_root(args)
    items, total = svc["list"](
        runtime_project_root=project_root,
        workspace_id=args.workspace_id,
        workspace_project_root=_workspace_root_str(project_root),
        enabled=args.enabled,
        limit=args.limit,
        offset=args.offset,
    )
    return {"status": "ok", "items": items, "total": total}


def _cmd_add(args: argparse.Namespace) -> dict[str, Any]:
    svc = _service()
    project_root = _resolved_project_root(args)
    markdown: str | None = None
    if args.source_path:
        markdown = Path(args.source_path).read_text(encoding="utf-8")

    skill = svc["create"](
        runtime_project_root=project_root,
        workspace_id=args.workspace_id,
        workspace_project_root=_workspace_root_str(project_root),
        skill_id=args.id,
        name=args.name,
        description=args.desc,
        enabled=bool(args.enabled),
        actor="cli",
        skill_markdown=markdown,
    )
    return {"status": "ok", "skill": skill}


def _cmd_update(args: argparse.Namespace) -> dict[str, Any]:
    svc = _service()
    project_root = _resolved_project_root(args)
    skill = svc["update"](
        runtime_project_root=project_root,
        workspace_id=args.workspace_id,
        workspace_project_root=_workspace_root_str(project_root),
        skill_id=args.id,
        name=args.name,
        description=args.desc,
        enabled=args.enabled,
        actor="cli",
    )
    return {"status": "ok", "skill": skill}


def _cmd_toggle(args: argparse.Namespace, enabled: bool) -> dict[str, Any]:
    svc = _service()
    project_root = _resolved_project_root(args)
    skill = svc["toggle"](
        runtime_project_root=project_root,
        workspace_id=args.workspace_id,
        workspace_project_root=_workspace_root_str(project_root),
        skill_id=args.id,
        enabled=enabled,
        reason=args.reason,
        actor="cli",
    )
    return {"status": "ok", "skill_id": args.id, "enabled": bool(skill["enabled"])}


def _cmd_remove(args: argparse.Namespace) -> dict[str, Any]:
    svc = _service()
    project_root = _resolved_project_root(args)
    deleted = svc["delete"](
        runtime_project_root=project_root,
        workspace_id=args.workspace_id,
        workspace_project_root=_workspace_root_str(project_root),
        skill_id=args.id,
        hard_delete=bool(args.hard_delete),
        actor="cli",
    )
    return {"status": "ok", "skill_id": args.id, "deleted": bool(deleted)}


def _cmd_audit(args: argparse.Namespace) -> dict[str, Any]:
    svc = _service()
    project_root = _resolved_project_root(args)
    items, total = svc["audit"](
        runtime_project_root=project_root,
        workspace_id=args.workspace_id,
        workspace_project_root=_workspace_root_str(project_root),
        limit=args.limit,
        offset=args.offset,
    )
    return {"status": "ok", "items": items, "total": total}


def _run(args: argparse.Namespace) -> dict[str, Any]:
    if args.cmd == "list":
        return _cmd_list(args)
    if args.cmd == "add":
        return _cmd_add(args)
    if args.cmd == "update":
        return _cmd_update(args)
    if args.cmd == "enable":
        return _cmd_toggle(args, enabled=True)
    if args.cmd == "disable":
        return _cmd_toggle(args, enabled=False)
    if args.cmd == "remove":
        return _cmd_remove(args)
    if args.cmd == "audit":
        return _cmd_audit(args)
    raise RuntimeError(f"Unsupported command: {args.cmd}")


def main() -> None:
    parser = _parser()
    args = parser.parse_args()
    svc = _service()
    error_type = svc["error"]

    try:
        result = _run(args)
    except error_type as exc:
        payload = {
            "error_code": exc.error_code,
            "message": exc.message,
            "details": exc.details,
        }
        _print_json(payload)
        raise SystemExit(1) from exc

    if args.format == "json":
        _print_json(result)
    else:
        print(result)
    raise SystemExit(0)


if __name__ == "__main__":
    main()
