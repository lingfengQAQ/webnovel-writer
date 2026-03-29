#!/usr/bin/env python3
"""
Test-only bootstrap for sandboxed Windows environments.

When WEBNOVEL_TMPDIR_FIX=1, monkeypatch tempfile.mkdtemp to create temp dirs
via PowerShell. This avoids intermittent ACL/permission issues where Python-
created temp dirs are not writable in constrained environments.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path


def _enable_windows_tmpdir_fix() -> None:
    if sys.platform != "win32":
        return
    if os.environ.get("WEBNOVEL_TMPDIR_FIX", "") != "1":
        return

    original_mkdtemp = tempfile.mkdtemp
    original_mkdir = os.mkdir

    def _ps_make_dir(path: Path) -> bool:
        cmd = f"New-Item -ItemType Directory -Path '{str(path)}' -Force | Out-Null"
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-Command", cmd],
            capture_output=True,
            text=True,
        )
        return proc.returncode == 0 and path.is_dir()

    def patched_mkdir(path, mode=0o777, *, dir_fd=None):  # noqa: ANN001
        if dir_fd is not None:
            return original_mkdir(path, mode, dir_fd=dir_fd)

        p = Path(path)
        if p.exists():
            raise FileExistsError(f"[WinError 183] Cannot create a file when that file already exists: '{p}'")

        if _ps_make_dir(p):
            return None

        return original_mkdir(path, mode)

    def patched_mkdtemp(suffix: str | None = None, prefix: str | None = None, dir: str | None = None) -> str:
        safe_prefix = prefix or "tmp"
        safe_suffix = suffix or ""
        base_dir = Path(dir or tempfile.gettempdir())

        # Try PowerShell-created directory first (better ACL behavior in sandbox).
        for _ in range(6):
            candidate = base_dir / f"{safe_prefix}{uuid.uuid4().hex}{safe_suffix}"
            if _ps_make_dir(candidate):
                return str(candidate)

        # Fallback to Python default behavior.
        return original_mkdtemp(suffix=suffix, prefix=prefix, dir=dir)

    os.mkdir = patched_mkdir
    tempfile.mkdtemp = patched_mkdtemp


_enable_windows_tmpdir_fix()
