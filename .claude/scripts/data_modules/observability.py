#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Shared observability helpers for data modules.
"""

from __future__ import annotations

import logging
from typing import Optional


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
