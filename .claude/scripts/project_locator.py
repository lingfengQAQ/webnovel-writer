#!/usr/bin/env python3
"""
Project location helpers for webnovel-writer scripts.

Problem this solves:
- Many scripts assumed CWD is the project root and used relative paths like `.webnovel/state.json`.
- In this repo, commands/scripts are often invoked from the repo root, while the actual project lives
  in a subdirectory (default: `webnovel-project/`).

These helpers provide a single, consistent way to locate the active project root.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, Optional


DEFAULT_PROJECT_DIR_NAMES: tuple[str, ...] = ("webnovel-project",)


def _find_git_root(cwd: Path) -> Optional[Path]:
    """Return nearest git root for cwd, if any."""
    for candidate in (cwd, *cwd.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def _candidate_roots(cwd: Path, *, stop_at: Optional[Path] = None) -> Iterable[Path]:
    yield cwd
    for name in DEFAULT_PROJECT_DIR_NAMES:
        yield cwd / name

    for parent in cwd.parents:
        yield parent
        for name in DEFAULT_PROJECT_DIR_NAMES:
            yield parent / name
        if stop_at is not None and parent == stop_at:
            break


def _is_project_root(path: Path) -> bool:
    return (path / ".webnovel" / "state.json").is_file()


def resolve_project_root(explicit_project_root: Optional[str] = None, *, cwd: Optional[Path] = None) -> Path:
    """
    Resolve the webnovel project root directory (the directory containing `.webnovel/state.json`).

    Resolution order:
    1) explicit_project_root (if provided)
    2) env var WEBNOVEL_PROJECT_ROOT (if set)
    3) Search from cwd and parents, including common subdir `webnovel-project/`

    Search safety:
    - If current location is inside a Git repo, parent search stops at the repo root.
      This avoids accidentally binding to unrelated parent directories.

    Raises:
        FileNotFoundError: if no valid project root can be found.
    """
    if explicit_project_root:
        root = Path(explicit_project_root).expanduser().resolve()
        if _is_project_root(root):
            return root
        raise FileNotFoundError(f"Not a webnovel project root (missing .webnovel/state.json): {root}")

    env_root = os.environ.get("WEBNOVEL_PROJECT_ROOT")
    if env_root:
        root = Path(env_root).expanduser().resolve()
        if _is_project_root(root):
            return root
        raise FileNotFoundError(f"WEBNOVEL_PROJECT_ROOT is set but invalid (missing .webnovel/state.json): {root}")

    base = (cwd or Path.cwd()).resolve()
    git_root = _find_git_root(base)
    for candidate in _candidate_roots(base, stop_at=git_root):
        if _is_project_root(candidate):
            return candidate.resolve()

    raise FileNotFoundError(
        "Unable to locate webnovel project root. Expected `.webnovel/state.json` under the current directory, "
        "a parent directory, or `webnovel-project/`. Run /webnovel-init first or pass --project-root / set "
        "WEBNOVEL_PROJECT_ROOT."
    )


def resolve_state_file(
    explicit_state_file: Optional[str] = None,
    *,
    explicit_project_root: Optional[str] = None,
    cwd: Optional[Path] = None,
) -> Path:
    """
    Resolve `.webnovel/state.json` path.

    If explicit_state_file is provided, returns it as-is (resolved to absolute if relative).
    Otherwise derives it from resolve_project_root().
    """
    base = (cwd or Path.cwd()).resolve()
    if explicit_state_file:
        p = Path(explicit_state_file).expanduser()
        return (base / p).resolve() if not p.is_absolute() else p.resolve()

    root = resolve_project_root(explicit_project_root, cwd=base)
    return root / ".webnovel" / "state.json"

