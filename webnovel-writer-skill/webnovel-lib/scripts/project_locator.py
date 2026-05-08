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

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

from runtime_compat import normalize_windows_path


DEFAULT_PROJECT_DIR_NAMES: tuple[str, ...] = ("webnovel-project",)
CURRENT_PROJECT_POINTER_REL: Path = Path(".claude") / ".webnovel-current-project"

# 用户级全局映射（当 skills/agents 安装在 ~/.claude 时，项目目录可能在任意盘符）
# 该文件用于在“空上下文 + CWD 不在项目内”的情况下仍能定位到正确 project_root。
GLOBAL_REGISTRY_REL: Path = Path("webnovel-writer") / "workspaces.json"

# Claude Code 常见环境变量（存在时优先作为“工作区根目录”提示）
ENV_CLAUDE_PROJECT_DIR = "CLAUDE_PROJECT_DIR"
ENV_CLAUDE_HOME = "CLAUDE_HOME"
ENV_WEBNOVEL_CLAUDE_HOME = "WEBNOVEL_CLAUDE_HOME"


def _find_git_root(cwd: Path) -> Optional[Path]:
    """Return nearest git root for cwd, if any."""
    for candidate in (cwd, *cwd.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _normcase_path_key(p: Path) -> str:
    """
    生成稳定的路径 key（Windows 下大小写/分隔符不敏感）。

    注意：key 仅用于映射表索引，实际路径仍以原始绝对路径字符串存储。
    """
    try:
        resolved = p.expanduser().resolve()
    except Exception:
        resolved = p.expanduser()
    return os.path.normcase(str(resolved))


def _get_user_claude_root() -> Path:
    raw = os.environ.get(ENV_WEBNOVEL_CLAUDE_HOME) or os.environ.get(ENV_CLAUDE_HOME)
    if raw:
        try:
            return normalize_windows_path(raw).expanduser().resolve()
        except Exception:
            return normalize_windows_path(raw).expanduser()
    return (Path.home() / ".claude").resolve()


def _global_registry_path() -> Path:
    return _get_user_claude_root() / GLOBAL_REGISTRY_REL


def _default_registry() -> dict:
    return {
        "schema_version": 1,
        "workspaces": {},
        "last_used_project_root": "",
        "updated_at": _now_iso(),
    }


def _load_global_registry(path: Path) -> dict:
    if not path.is_file():
        return _default_registry()
    try:
        data = json.loads(path.read_text(encoding="utf-8") or "{}")
    except Exception:
        return _default_registry()
    if not isinstance(data, dict):
        return _default_registry()

    if data.get("schema_version") != 1:
        data["schema_version"] = 1
    if not isinstance(data.get("workspaces"), dict):
        data["workspaces"] = {}
    if not isinstance(data.get("last_used_project_root"), str):
        data["last_used_project_root"] = ""
    if not isinstance(data.get("updated_at"), str):
        data["updated_at"] = _now_iso()
    return data


def _save_global_registry(path: Path, data: dict) -> None:
    # 写入是 best-effort：用户目录权限/只读盘符等情况不应阻断主流程。
    try:
        from security_utils import atomic_write_json

        data["updated_at"] = _now_iso()
        atomic_write_json(path, data, backup=False)
    except Exception:
        # 非阻断
        return


def _resolve_project_root_from_global_registry(
    base: Path,
    *,
    workspace_hint: Optional[Path] = None,
    allow_last_used_fallback: bool = False,
) -> Optional[Path]:
    """
    从用户级 registry 中解析 project_root。

    安全策略：
    - 优先使用 workspace_hint / CLAUDE_PROJECT_DIR 提示做匹配。
    - 默认不使用 last_used 兜底，避免在“完全无上下文”时误命中错误项目。
    """
    reg_path = _global_registry_path()
    reg = _load_global_registry(reg_path)
    workspaces = reg.get("workspaces") or {}
    if not isinstance(workspaces, dict) or not workspaces:
        return None

    hints: list[Path] = []
    env_ws = os.environ.get(ENV_CLAUDE_PROJECT_DIR)
    if env_ws:
        hints.append(normalize_windows_path(env_ws).expanduser())
    if workspace_hint is not None:
        hints.append(workspace_hint)
    hints.append(base)

    # 1) 精确匹配
    for hint in hints:
        key = _normcase_path_key(hint)
        entry = workspaces.get(key)
        if isinstance(entry, dict):
            raw = entry.get("current_project_root")
            if isinstance(raw, str) and raw.strip():
                target = normalize_windows_path(raw).expanduser()
                if not target.is_absolute():
                    continue
                if _is_project_root(target):
                    return target.resolve()

    # 2) 前缀匹配（从 workspace 子目录运行时）
    for hint in hints:
        hint_key = _normcase_path_key(hint)
        best_key: Optional[str] = None
        best_len = -1
        for ws_key in workspaces.keys():
            if not isinstance(ws_key, str) or not ws_key:
                continue
            ws_key_norm = os.path.normcase(ws_key)
            if hint_key == ws_key_norm or hint_key.startswith(ws_key_norm.rstrip("\\") + "\\"):
                if len(ws_key_norm) > best_len:
                    best_key = ws_key
                    best_len = len(ws_key_norm)
        if best_key:
            entry = workspaces.get(best_key)
            if isinstance(entry, dict):
                raw = entry.get("current_project_root")
                if isinstance(raw, str) and raw.strip():
                    target = normalize_windows_path(raw).expanduser()
                    if target.is_absolute() and _is_project_root(target):
                        return target.resolve()

    # 3) last_used（可选，默认关闭）
    if allow_last_used_fallback:
        raw = reg.get("last_used_project_root")
        if isinstance(raw, str) and raw.strip():
            target = normalize_windows_path(raw).expanduser()
            if target.is_absolute() and _is_project_root(target):
                return target.resolve()

    return None


def update_global_registry_current_project(
    *,
    workspace_root: Optional[Path],
    project_root: Path,
) -> Optional[Path]:
    """
    更新用户级 registry：workspace -> current_project_root 映射。

    返回：registry 文件路径（写入失败则返回 None）。
    """
    root = normalize_windows_path(project_root).expanduser()
    try:
        root = root.resolve()
    except Exception:
        root = root
    if not _is_project_root(root):
        raise FileNotFoundError(f"Not a webnovel project root (missing .webnovel/state.json): {root}")

    ws = workspace_root
    if ws is None:
        env_ws = os.environ.get(ENV_CLAUDE_PROJECT_DIR)
        if env_ws:
            ws = normalize_windows_path(env_ws).expanduser()
    if ws is None:
        return None

    try:
        ws = ws.expanduser().resolve()
    except Exception:
        ws = ws.expanduser()

    reg_path = _global_registry_path()
    reg = _load_global_registry(reg_path)
    workspaces = reg.get("workspaces")
    if not isinstance(workspaces, dict):
        workspaces = {}
        reg["workspaces"] = workspaces

    workspaces[_normcase_path_key(ws)] = {
        "workspace_root": str(ws),
        "current_project_root": str(root),
        "updated_at": _now_iso(),
    }
    reg["last_used_project_root"] = str(root)
    _save_global_registry(reg_path, reg)
    return reg_path


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


def _pointer_candidates(cwd: Path, *, stop_at: Optional[Path] = None) -> Iterable[Path]:
    """Yield candidate pointer files from cwd up to parents (bounded by stop_at when provided)."""
    for candidate in (cwd, *cwd.parents):
        yield candidate / CURRENT_PROJECT_POINTER_REL
        if stop_at is not None and candidate == stop_at:
            break


def _resolve_project_root_from_pointer(cwd: Path, *, stop_at: Optional[Path] = None) -> Optional[Path]:
    """
    Resolve project root from workspace pointer file.

    Pointer file format:
    - plain text absolute path, one line.
    - relative path is also supported (resolved relative to pointer's `.claude/` dir).
    """
    for pointer_file in _pointer_candidates(cwd, stop_at=stop_at):
        if not pointer_file.is_file():
            continue
        raw = pointer_file.read_text(encoding="utf-8").strip()
        if not raw:
            continue
        target = normalize_windows_path(raw).expanduser()
        if not target.is_absolute():
            target = (pointer_file.parent / target).resolve()
        if _is_project_root(target):
            return target.resolve()
    return None


def _resolve_unique_child_project_root(root: Path) -> Optional[Path]:
    """
    Resolve a workspace root that contains exactly one direct child book project.

    This supports commands invoked with a parent workspace path while keeping
    ambiguous multi-book workspaces explicit.
    """
    try:
        children = [child.resolve() for child in root.iterdir() if child.is_dir() and _is_project_root(child)]
    except OSError:
        return None
    if len(children) == 1:
        return children[0]
    return None


def _find_workspace_root_with_claude(start: Path) -> Optional[Path]:
    """Find nearest ancestor containing `.claude/`."""
    for candidate in (start, *start.parents):
        if (candidate / ".claude").is_dir():
            return candidate
    return None


def write_current_project_pointer(project_root: Path, *, workspace_root: Optional[Path] = None) -> Optional[Path]:
    """
    Write workspace-level current project pointer and return pointer file path.

    If no workspace root with `.claude/` can be found, returns None (non-fatal).
    """
    root = normalize_windows_path(project_root).expanduser().resolve()
    if not _is_project_root(root):
        raise FileNotFoundError(f"Not a webnovel project root (missing .webnovel/state.json): {root}")

    ws_root = Path(workspace_root).expanduser().resolve() if workspace_root else _find_workspace_root_with_claude(root)
    if ws_root is None:
        ws_root = _find_workspace_root_with_claude(Path.cwd().resolve())
    if ws_root is None:
        # 兜底：若无法找到 `.claude/`，将项目父目录视为“工作区”候选，
        # 仅用于写入用户级 registry（不创建 `.claude/` 目录，不写 pointer 文件）。
        ws_root = root.parent if root.parent != root else None
    # 注意：ws_root 可能为 None（例如全局安装的 skills/agents，工作区内没有 `.claude/`）。
    # 这类情况仍然需要写入用户级 registry，以支持后续“空上下文”定位。

    pointer_file: Optional[Path] = None
    if ws_root is not None:
        # 仅当工作区内已经存在 `.claude/` 时才写入指针，避免在任意目录下“凭空创建 .claude/”。
        if (ws_root / ".claude").is_dir():
            try:
                pointer_file = ws_root / CURRENT_PROJECT_POINTER_REL
                pointer_file.write_text(str(root), encoding="utf-8")
            except Exception:
                pointer_file = None

    # best-effort 更新用户级 registry（不阻断）
    try:
        update_global_registry_current_project(workspace_root=ws_root, project_root=root)
    except Exception:
        pass

    return pointer_file


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
        root = normalize_windows_path(explicit_project_root).expanduser().resolve()
        if _is_project_root(root):
            return root

        # 兼容：显式传入“工作区根目录”（含 `.claude/.webnovel-current-project` 指针）
        # 例如：D:\wk\xiaoshuo 不是项目根，但其指针指向 D:\wk\xiaoshuo\<书名>
        pointer_root = _resolve_project_root_from_pointer(root, stop_at=_find_git_root(root))
        if pointer_root is not None:
            return pointer_root

        child_root = _resolve_unique_child_project_root(root)
        if child_root is not None:
            return child_root

        # 兼容：显式传入“工作区根目录”但其 `.claude/` 在用户目录（全局安装）时，
        # workspace 内部可能没有指针文件。此时从用户级 registry 查找。
        reg_root = _resolve_project_root_from_global_registry(
            root,
            workspace_hint=root,
            allow_last_used_fallback=False,
        )
        if reg_root is not None:
            return reg_root

        raise FileNotFoundError(f"Not a webnovel project root (missing .webnovel/state.json): {root}")

    env_root = os.environ.get("WEBNOVEL_PROJECT_ROOT")
    if env_root:
        root = normalize_windows_path(env_root).expanduser().resolve()
        if _is_project_root(root):
            return root
        raise FileNotFoundError(f"WEBNOVEL_PROJECT_ROOT is set but invalid (missing .webnovel/state.json): {root}")

    base = (cwd or Path.cwd()).resolve()
    git_root = _find_git_root(base)

    # Workspace pointer fallback (for layouts where `.claude` is in workspace root and projects are subdirs).
    pointer_root = _resolve_project_root_from_pointer(base, stop_at=git_root)
    if pointer_root is not None:
        return pointer_root

    # 用户级 registry fallback（仅在“有上下文提示”时启用，避免误命中）
    # - 若 CLAUDE_PROJECT_DIR 存在：认为 Claude Code 提供了工作区上下文
    # - 否则仅在 base 位于某个已记录 workspace 内时启用（前缀匹配）
    allow_last_used = bool(os.environ.get(ENV_CLAUDE_PROJECT_DIR))
    reg_root = _resolve_project_root_from_global_registry(
        base,
        workspace_hint=None,
        allow_last_used_fallback=allow_last_used,
    )
    if reg_root is not None:
        return reg_root

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

