#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


MAX_LINES = 8
MAX_CHARS = 1000
DISABLE_ENV = "WEBNOVEL_DISABLE_SESSION_STATUS_HOOK"


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _clip(text: str) -> str:
    lines = [line for line in text.splitlines() if line.strip()][:MAX_LINES]
    clipped = "\n".join(lines).strip()
    if len(clipped) > MAX_CHARS:
        clipped = clipped[: MAX_CHARS - 3].rstrip() + "..."
    return clipped


def main() -> int:
    if _truthy(os.environ.get(DISABLE_ENV)):
        return 0

    # OpenCode compat: check OPENCODE_PLUGIN_ROOT / OPENCODE_PROJECT_DIR as fallback
    plugin_root = Path(
        os.environ.get("CLAUDE_PLUGIN_ROOT")
        or os.environ.get("OPENCODE_PLUGIN_ROOT")
        or Path(__file__).resolve().parents[1]
    )
    workspace_root = os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get("OPENCODE_PROJECT_DIR") or os.getcwd()
    webnovel = plugin_root / "scripts" / "webnovel.py"
    if not webnovel.is_file():
        return 0

    try:
        proc = subprocess.run(
            [
                sys.executable,
                "-X",
                "utf8",
                str(webnovel),
                "--project-root",
                str(workspace_root),
                "project-status",
                "--format",
                "summary",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=4,
        )
    except Exception:
        return 0

    output = _clip(proc.stdout or proc.stderr or "")
    if output:
        print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
