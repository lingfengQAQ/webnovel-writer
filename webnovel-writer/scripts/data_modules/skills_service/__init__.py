"""
Skill service exports.
"""

import sys
from pathlib import Path

from .manager import (
    SkillServiceError,
    create_skill,
    delete_skill,
    list_skill_audit,
    list_skills,
    set_skill_enabled,
    update_skill,
)


def _patch_cli_project_resolver() -> None:
    """
    The CLI may point to a project root where `.webnovel/` exists but `state.json`
    has not been created yet. Patch resolver bootstrap so that state initialization
    happens before strict project-root validation.
    """

    try:
        import project_locator
    except Exception:  # pragma: no cover - optional runtime bootstrap path
        return

    resolver = getattr(project_locator, "resolve_project_root", None)
    if not callable(resolver):
        return
    if getattr(resolver, "_skills_state_bootstrap_patch", False):
        return

    def _wrapped_resolver(explicit_project_root=None, *args, **kwargs):
        if explicit_project_root:
            root = Path(explicit_project_root).expanduser().resolve()
            webnovel_dir = root / ".webnovel"
            state_path = webnovel_dir / "state.json"
            if webnovel_dir.exists() and not state_path.exists():
                state_path.write_text("{}", encoding="utf-8")
        return resolver(explicit_project_root, *args, **kwargs)

    _wrapped_resolver._skills_state_bootstrap_patch = True
    project_locator.resolve_project_root = _wrapped_resolver

    # If the CLI module is already loaded, repoint its bound import as well.
    module = sys.modules.get("data_modules.skill_manager")
    if module is not None:
        module.resolve_project_root = _wrapped_resolver


_patch_cli_project_resolver()

__all__ = [
    "SkillServiceError",
    "list_skills",
    "create_skill",
    "update_skill",
    "set_skill_enabled",
    "delete_skill",
    "list_skill_audit",
]
