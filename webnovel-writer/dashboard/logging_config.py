"""
P2-C 修复：结构化日志配置模块

替代项目中散落的 print() 调用，提供统一的日志级别控制、
JSON 格式输出（生产环境）和可读格式输出（开发环境）。

用法：
    from dashboard.logging_config import setup_logging, get_logger

    # 在 server.py main() 中初始化一次
    setup_logging(level="INFO", json_output=False)

    # 在各模块中获取 logger
    logger = get_logger(__name__)
    logger.info("项目路径已加载", extra={"project_root": str(root)})
"""

from __future__ import annotations

import json
import logging
import sys
import time
from datetime import datetime, timezone
from typing import Any


# ---------------------------------------------------------------------------
# JSON 格式化器
# ---------------------------------------------------------------------------

class _JsonFormatter(logging.Formatter):
    """将日志记录序列化为单行 JSON，适合生产环境日志收集。"""

    def format(self, record: logging.LogRecord) -> str:
        message = record.getMessage()
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": message,
        }

        # 附加 extra 字段
        for key, value in record.__dict__.items():
            if key not in {
                "name", "msg", "args", "created", "filename", "funcName",
                "levelname", "levelno", "lineno", "module", "msecs", "message",
                "pathname", "process", "processName", "relativeCreated",
                "stack_info", "thread", "threadName", "exc_info", "exc_text",
            }:
                payload[key] = value

        # 异常信息
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)

        try:
            return json.dumps(payload, ensure_ascii=False)
        except (TypeError, ValueError):
            payload["message"] = repr(message)
            return json.dumps(payload, ensure_ascii=False)


# ---------------------------------------------------------------------------
# 公共 API
# ---------------------------------------------------------------------------

def setup_logging(
    level: str = "INFO",
    json_output: bool = False,
    logger_name: str = "dashboard",
) -> None:
    """初始化 Dashboard 日志系统。

    Args:
        level: 日志级别字符串，如 "DEBUG"、"INFO"、"WARNING"、"ERROR"。
        json_output: True 时输出 JSON 格式（生产推荐），False 时输出可读格式（开发默认）。
        logger_name: 根 logger 名称，默认 "dashboard"。
    """
    root_logger = logging.getLogger(logger_name)
    root_logger.setLevel(getattr(logging, level.upper(), logging.INFO))

    # 避免重复添加 handler（热重载场景）
    if root_logger.handlers:
        return

    handler = logging.StreamHandler(sys.stdout)
    if json_output:
        handler.setFormatter(_JsonFormatter())
    else:
        fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
        handler.setFormatter(logging.Formatter(fmt, datefmt="%Y-%m-%d %H:%M:%S"))

    root_logger.addHandler(handler)
    root_logger.propagate = False


def get_logger(name: str) -> logging.Logger:
    """获取命名 logger。

    建议在模块顶部调用：
        logger = get_logger(__name__)
    """
    return logging.getLogger(name)
