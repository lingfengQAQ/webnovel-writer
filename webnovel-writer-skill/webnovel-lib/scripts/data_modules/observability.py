#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Shared observability helpers for data modules.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional


logger = logging.getLogger(__name__)


def safe_log_tool_call(
    tool_logger,
    *,
    tool_name: str,
    success: bool,
    retry_count: int = 0,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
    chapter: Optional[int] = None,
) -> None:
    try:
        tool_logger.log_tool_call(
            tool_name,
            success,
            retry_count=retry_count,
            error_code=error_code,
            error_message=error_message,
            chapter=chapter,
        )
    except Exception as exc:
        logger.warning(
            "failed to log tool call %s: %s",
            tool_name,
            exc,
        )


def safe_append_perf_timing(
    project_root: str | Path,
    *,
    tool_name: str,
    success: bool,
    elapsed_ms: int,
    chapter: Optional[int] = None,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Append timing trace for profiling long-running data-agent pipeline steps.

    Output path:
    - {project_root}/.webnovel/observability/data_agent_timing.jsonl
    """
    try:
        root = Path(project_root).resolve()
        obs_dir = root / ".webnovel" / "observability"
        obs_dir.mkdir(parents=True, exist_ok=True)
        log_path = obs_dir / "data_agent_timing.jsonl"

        payload: Dict[str, Any] = {
            "timestamp": datetime.now().isoformat(),
            "tool_name": tool_name,
            "success": bool(success),
            "elapsed_ms": int(max(0, elapsed_ms)),
        }
        if chapter is not None:
            payload["chapter"] = int(chapter)
        if error_code:
            payload["error_code"] = error_code
        if error_message:
            payload["error_message"] = error_message
        if meta:
            payload["meta"] = meta

        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception as exc:
        logger.warning("failed to append perf timing for %s: %s", tool_name, exc)
